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

import { subscription } from "@atomist/skill";

export type EventSubscription =
	| subscription.types.OnPushSubscription
	| subscription.types.OnTagSubscription;

/** Extract commit from event data. */
export function eventCommit(
	data: EventSubscription,
): { sha?: string; url?: string } {
	return (
		(data as subscription.types.OnPushSubscription).Push?.[0]?.after ||
		(data as subscription.types.OnTagSubscription).Tag?.[0]?.commit
	);
}

/** Extract repo from event data. */
export function eventRepo(
	data: EventSubscription,
): {
	channels?: Array<{ name?: string }>;
	defaultBranch?: string;
	name?: string;
	owner?: string;
	org?: { provider?: { apiUrl?: string } };
} {
	return (
		(data as subscription.types.OnPushSubscription).Push?.[0]?.repo ||
		(data as subscription.types.OnTagSubscription).Tag?.[0]?.commit?.repo
	);
}
