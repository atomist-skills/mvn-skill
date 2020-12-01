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

export function tokenizeArgString(argString: string | string[]): string[] {
	if (Array.isArray(argString)) {
		return argString.map(e => (typeof e !== "string" ? e + "" : e));
	}
	argString = argString.trim();
	let i = 0;
	let prevC = null;
	let c = null;
	let opening = null;
	const args = [];
	for (let ii = 0; ii < argString.length; ii++) {
		prevC = c;
		c = argString.charAt(ii);
		// split on spaces unless we're in quotes.
		if (c === " " && !opening) {
			if (!(prevC === " ")) {
				i++;
			}
			continue;
		}
		// don't split the string if we're in matching
		// opening or closing single and double quotes.
		if (c === opening) {
			opening = null;
		} else if ((c === "'" || c === '"') && !opening) {
			opening = c;
		}
		if (!args[i]) args[i] = "";
		args[i] += c;
	}
	return args;
}
