import { Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { renderStoryInventory } from "../modules/story-inventory/index.js";
import { handle, printJson, run, runFlag } from "./shared.js";

const publish = Command.make("publish", { run: runFlag }, handle(({ run: runPath }) => Effect.gen(function* () {
  const settings = yield* run(runPath);
  yield* printJson(yield* renderStoryInventory({ storiesDirectory: settings.storiesDirectory, booksDirectory: settings.booksDirectory, settings: settings.inventory }));
}))).pipe(Command.withDescription("Rebuild the reading inventories: one Markdown view per book beside its intake, and the combined Markdown and JSON views beside the stories. Books are discovered from the manifests."));

export const inventoryCommand = Command.make("inventory").pipe(Command.withDescription("Reading views over every story manifest."), Command.withSubcommands([publish]));
