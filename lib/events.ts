/*
 * Copyright © 2020 Atomist, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
	childProcess,
	EventContext,
	EventHandler,
	github,
	project,
	repository,
	runSteps,
	secret,
	status,
	Step,
	subscription,
} from "@atomist/skill";
import { WritableLog } from "@atomist/skill/src/lib/child_process";
import * as fs from "fs-extra";
import { extractAnnotations } from "./annotation";
import { tokenizeArgString } from "./args";
import { Configuration } from "./configuration";
import { eventCommit, eventRepo } from "./git";
import { spawnFailure, statusReason, trimDirectory } from "./status";

interface MvnParameters {
	project: project.Project;
	check: github.Check;
	body: string[];
}

type MvnStep = Step<
	EventContext<
		| subscription.types.OnPushSubscription
		| subscription.types.OnTagSubscription,
		Configuration
	>,
	MvnParameters
>;

const LoadProjectStep: MvnStep = {
	name: "load",
	run: async (ctx, params) => {
		const repo = eventRepo(ctx.data);

		const credential = await ctx.credential.resolve(
			secret.gitHubAppToken({
				owner: repo.owner,
				repo: repo.name,
				apiUrl: repo.org.provider.apiUrl,
			}),
		);

		const project: project.Project = await ctx.project.load(
			repository.gitHub({
				owner: repo.owner,
				repo: repo.name,
				credential,
			}),
			process.cwd(),
		);
		// const project: project.Project = await ctx.project.clone(
		// 	repository.gitHub({
		// 		owner: repo.owner,
		// 		repo: repo.name,
		// 		credential,
		// 	}),
		// );
		params.project = project;

		return status.success();
	},
};

const ValidateStep: MvnStep = {
	name: "validate",
	run: async (ctx, params) => {
		if (!(await fs.pathExists(params.project.path("pom.xml")))) {
			return status
				.success(`Ignoring push to non-Maven project`)
				.hidden()
				.abort();
		}

		// raise the check
		const commit = eventCommit(ctx.data);
		params.check = await github.createCheck(ctx, params.project.id, {
			sha: commit.sha,
			title: "mvn",
			name: `${ctx.skill.name}/${ctx.configuration?.name}`,
			body: "Running Maven build",
		});
		params.body = [];

		return status.success();
	},
};

const CommandStep: MvnStep = {
	name: "command",
	runWhen: async ctx => !!ctx.configuration?.parameters?.command,
	run: async (ctx, params) => {
		const repo = eventRepo(ctx.data);
		const commit = eventCommit(ctx.data);
		const result = await childProcess.spawnPromise(
			"bash",
			["-c", ctx.configuration.parameters.command],
			{ log: childProcess.captureLog() },
		);
		if (result.status !== 0) {
			params.body.push(spawnFailure(result));
			await params.check.update({
				conclusion: "failure",
				body: params.body.join("\n\n---\n\n"),
			});
			return status.failure(
				statusReason({
					reason: `\`${result.cmdString}\` failed`,
					repo,
					commit,
				}),
			);
		}
		params.body.push(
			`Setup command \`${trimDirectory(result.cmdString)}\` successful`,
		);
		await params.check.update({
			conclusion: undefined,
			body: params.body.join("\n\n---\n\n"),
		});
		return status.success();
	},
};

const PrepareStep: MvnStep = {
	name: "prepare",
	runWhen: async ctx => !!ctx.configuration?.parameters?.settings,
	run: async (ctx, params) => {
		const cfg = ctx.configuration.parameters;
		await fs.ensureDir(params.project.path(".m2"));
		await fs.writeFile(
			params.project.path(".m2", "settings.xml"),
			cfg.settings,
		);

		await params.check.update({
			conclusion: undefined,
			body: params.body.join("\n\n---\n\n"),
		});
		return status.success();
	},
};

const SetupNodeStep: MvnStep = {
	name: "setup jdk",
	run: async (ctx, params) => {
		const repo = eventRepo(ctx.data);
		const commit = eventCommit(ctx.data);
		const cfg = ctx.configuration?.parameters;
		// Set up jdk
		const result = await params.project.spawn("bash", [
			"-c",
			`source $SDKMAN_DIR/bin/sdkman-init.sh && sdk install java ${cfg.version}`,
		]);
		if (result.status !== 0) {
			params.body.push(spawnFailure(result));
			await params.check.update({
				conclusion: "failure",
				body: params.body.join("\n\n---\n\n"),
			});
			return status.failure(
				statusReason({
					reason: `\`${result.cmdString}\` failed`,
					repo,
					commit,
				}),
			);
		}

		params.body.push(`Installed JDK version \`${cfg.version}\``);
		await params.check.update({
			conclusion: undefined,
			body: params.body.join("\n\n---\n\n"),
		});
		return status.success();
	},
};

const MvnGoalsStep: MvnStep = {
	name: "mvn",
	run: async (ctx, params) => {
		const repo = eventRepo(ctx.data);
		const commit = eventCommit(ctx.data);
		const cfg = ctx.configuration?.parameters;
		let args = tokenizeArgString(cfg.mvn || "clean install");
		const options = [];
		let command = (await fs.pathExists(params.project.path("mvnw")))
			? "./mvnw"
			: "mvn";

		// Deal with user provided command in the args parameter
		if (args[0] === "mvn" || args[0] === "./mvnw") {
			command = args[0];
			args = args.slice(1);
		}

		// Set the repository location so that caching can pick it up
		if (!args.some(a => a.includes("-Dmaven.repo.local"))) {
			options.push(`-Dmaven.repo.local=.m2`);
		}
		if (
			(await fs.pathExists(params.project.path(".m2", "settings.xml"))) &&
			!args.some(a => a.includes("--settings=")) &&
			!args.some(a => a === "--settings") &&
			!args.some(a => a.includes("-s=") && !args.some(a => a === "-s"))
		) {
			options.push(
				`--settings=${params.project.path(".m2", "settings.xml")}`,
			);
		}

		// Run maven
		const log = captureLog();
		const result = await params.project.spawn(
			command,
			[...options, ...args],
			{
				env: {
					...process.env,
					JAVA_HOME: "/opt/.sdkman/candidates/java/current",
					PATH: `/opt/.sdkman/candidates/maven/current/bin:/opt/.sdkman/candidates/java/current/bin:${process.env.PATH}`,
				},
				log,
				logCommand: false,
			},
		);
		const annotations = extractAnnotations(log.log);
		if (result.status !== 0 || annotations.length > 0) {
			const home = process.env.ATOMIST_HOME || "/atm/home";
			result.stderr = log.log;
			params.body.push(spawnFailure(result));
			await params.check.update({
				conclusion: "failure",
				body: params.body.join("\n\n---\n\n"),
				annotations: annotations.map(r => ({
					annotationLevel: r.severity,
					path: r.path.replace(home + "/", ""),
					startLine: r.line ? +r.line : undefined,
					endLine: r.line ? +r.line : undefined,
					startOffset: r.column ? +r.column : undefined,
					title: r.title,
					message: r.message,
				})),
			});
			return status.failure(
				statusReason({
					reason: `\`${result.cmdString}\` failed`,
					commit,
					repo,
				}),
			);
		}
		params.body.push(`\`${trimDirectory(result.cmdString)}\` successful`);
		await params.check.update({
			conclusion: "success",
			body: params.body.join("\n\n---\n\n"),
		});
		return status.success(
			statusReason({
				reason: `Maven build succeeded`,
				commit,
				repo,
			}),
		);
	},
};

export const handler: EventHandler<
	| subscription.types.OnPushSubscription
	| subscription.types.OnTagSubscription,
	Configuration
> = async ctx =>
	runSteps({
		context: ctx,
		steps: [
			LoadProjectStep,
			ValidateStep,
			CommandStep,
			PrepareStep,
			SetupNodeStep,
			MvnGoalsStep,
		],
		parameters: { body: [] },
	});

export function captureLog(): WritableLog & { log: string } {
	const logLines = [];
	return {
		write: (msg): void => {
			process.stdout.write(msg);
			logLines.push(msg);
		},
		get log() {
			return logLines.join("");
		},
	};
}
