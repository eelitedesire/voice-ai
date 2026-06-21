// The `sherpa-onnx-node` package ships plain JS without type declarations.
// Declaring it as an ambient module lets us import it (typed as `any`) without
// the implicit-any module-resolution error, matching how it's used across the
// codebase (recognizer / VAD / speaker handles are all opaque native objects).
declare module 'sherpa-onnx-node';
