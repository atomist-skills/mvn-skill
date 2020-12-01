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
import * as fs from "fs-extra";
import { extractAnnotations } from "./annotation";
import { tokenizeArgString } from "./args";
import { Configuration } from "./configuration";
import { eventCommit, eventRepo } from "./git";
import { spawnFailure, statusReason } from "./status";

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
		params.body.push(`Setup command \`${result.cmdString}\` successful`);
		await params.check.update({
			conclusion: undefined,
			body: params.body.join("\n\n---\n\n"),
		});
		return status.success();
	},
};

const PrepareStep: MvnStep = {
	name: "prepare",
	run: async (ctx, params) => {
		// TODO cd add creds

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
		const args = tokenizeArgString(cfg.mvn || "clean install");
		const command = (await fs.pathExists(params.project.path(".mvnw")))
			? ".mvnw"
			: "mvn";

		// Run maven
		const captureLog = childProcess.captureLog();
		const result = await params.project.spawn(
			command,
			[
				...args,
				"-B",
				"-Dorg.slf4j.simpleLogger.log.org.apache.maven.cli.transfer.Slf4jMavenTransferListener=warn",
			],
			{
				env: {
					...process.env,
					JAVA_HOME: "/opt/.sdkman/candidates/java/current",
					PATH: `/opt/.sdkman/candidates/maven/current/bin:/opt/.sdkman/candidates/java/current/bin:${process.env.PATH}`,
				},
				log: captureLog,
				logCommand: false,
			},
		);
		const annotations = extractAnnotations(captureLog.log);
		if (result.status !== 0 || annotations.length > 0) {
			const home = process.env.ATOMIST_HOME || "/atm/home";
			result.stderr = captureLog.log;
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
		params.body.push(`\`${result.cmdString}\` successful`);
		await params.check.update({
			conclusion: undefined,
			body: params.body.join("\n\n---\n\n"),
		});
		return status.success(
			statusReason({
				reason: `Maven build of ${repo.owner}/${repo.name} succeeded`,
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
