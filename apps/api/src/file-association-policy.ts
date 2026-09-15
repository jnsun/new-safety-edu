export type FileAssociationCandidate = {
  id: string;
  kind: string;
  uploadedBy: string;
};

function policyError(message: string, code: string, statusCode: number) {
  return Object.assign(new Error(message), { code, statusCode });
}

export function assertOwnedFiles(
  candidates: FileAssociationCandidate[],
  requestedIds: string[],
  accountId: string,
  expectedKind: string,
) {
  if (new Set(requestedIds).size !== requestedIds.length) {
    throw policyError("文件列表包含重复项", "DUPLICATE_FILE_ID", 400);
  }
  const validIds = new Set(
    candidates
      .filter((file) => file.uploadedBy === accountId && file.kind === expectedKind)
      .map((file) => file.id),
  );
  if (requestedIds.some((fileId) => !validIds.has(fileId))) {
    throw policyError("只能关联本人上传且类型正确的文件", "FILE_ASSOCIATION_FORBIDDEN", 403);
  }
}
