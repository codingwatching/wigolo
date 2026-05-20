// Default reranker to 'none' in tests so the cross-encoder model isn't lazily
// downloaded. Tests that exercise the reranker explicitly set
// WIGOLO_RERANKER='onnx' and mock the rerank provider in their own scope.
if (!process.env.WIGOLO_RERANKER) {
  process.env.WIGOLO_RERANKER = 'none';
}
