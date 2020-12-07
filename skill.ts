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
	Category,
	LineStyle,
	parameter,
	ParameterType,
	ParameterVisibility,
	resourceProvider,
	skill,
} from "@atomist/skill";
import { Configuration } from "./lib/configuration";

export const Skill = skill<
	Configuration & {
		repos: any;
		subscription_filter: any;
		env_map: any;
		ref_filter: any;
	}
>({
	description: "Run Maven on your Java project",
	displayName: "Maven",
	categories: [Category.DevOps],
	iconUrl:
		"https://raw.githubusercontent.com/atomist-skills/mvn-skill/main/docs/images/icon.svg",

	resourceProviders: {
		github: resourceProvider.gitHub({ minRequired: 1 }),
		secret: resourceProvider.secretProvider({
			minRequired: 0,
			maxAllowed: undefined,
		} as any),
	},

	containers: {
		mvn: {
			image: "gcr.io/atomist-container-skills/mvn-skill",
		},
	},

	parameters: {
		env_map: {
			type: ParameterType.String,
			displayName: "",
			description:
				"Map selected secrets to environment variables that will be available in the running container",
			required: false,
		},
		subscription_filter: {
			type: ParameterType.MultiChoice,
			displayName: "Triggers",
			description: "Select one or more trigger for this skill",
			options: [
				{
					text: "GitHub > push",
					value: "onPush",
				},
				{
					text: "GitHub > tag",
					value: "onTag",
				},
			],
			defaultValues: ["onPush"],
			required: true,
		},
		mvn: {
			type: ParameterType.String,
			displayName: "Maven arguments",
			description: "Maven arguments to pass to `mvn` or `mvnw`",
			required: true,
			placeHolder: "clean install",
			lineStyle: LineStyle.Multiple,
		},
		version: {
			type: ParameterType.SingleChoice,
			displayName: "Java version",
			description: "Version of Java to use",
			options: [
				{
					text: "15",
					value: "15.0.1.hs-adpt",
				},
				{
					text: "14",
					value: "14.0.2.hs-adpt",
				},
				{
					text: "13",
					value: "13.0.2.hs-adpt",
				},
				{
					text: "12",
					value: "12.0.2.hs-adpt",
				},
				{
					text: "11 (default)",
					value: "11.0.9.hs-adpt",
				},
				{
					text: "8",
					value: "8.0.275.hs-adpt",
				},
			],
			defaultValue: "11.0.9.hs-adpt",
			required: false,
		},
		settings: {
			type: ParameterType.String,
			displayName: "Settings file",
			description: "Provide a `settings.xml` file that will be used",
			lineStyle: LineStyle.Multiple,
			required: false,
		},
		ref_filter: {
			...parameter.refFilter(),
			visibility: ParameterVisibility.Advanced,
		},
		command: {
			type: ParameterType.String,
			displayName: "Shell command",
			description:
				"Specify a shell command to be executed with `bash -c` on a Ubuntu-based environment to set up needed tools for your Maven build",
			lineStyle: LineStyle.Multiple,
			required: false,
			visibility: ParameterVisibility.Advanced,
		},
		docker_cache: {
			type: ParameterType.StringArray,
			displayName: "Cache files or folders",
			description:
				"Cache and restore file system content between executions of this skill",
			required: false,
			defaultValue: [".m2/**"],
			visibility: ParameterVisibility.Advanced,
		},
		repos: parameter.repoFilter(),
	},

	subscriptions: [
		"@atomist/skill/github/onPush",
		"@atomist/skill/github/onTag",
	],
});
