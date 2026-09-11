import { Schema } from "effect";
/** Decode an already-parsed value strictly: unknown keys are an error, so drift between writer and reader fails at the boundary. Throws on mismatch. */
export function decodeStrict(schema, value) {
    return Schema.decodeUnknownSync(schema, { onExcessProperty: "error" })(value);
}
//# sourceMappingURL=decode.js.map