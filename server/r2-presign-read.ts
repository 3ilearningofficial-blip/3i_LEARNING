/**
 * Short-lived presigned GET URLs so browsers fetch bytes from R2 directly
 * (avoids proxy/gateway timeouts on large PDFs and video range requests).
 */
export async function presignR2GetObject(
  getR2Client: () => Promise<any>,
  objectKey: string,
  expiresInSeconds: number,
): Promise<string | null> {
  const bucket = String(process.env.R2_BUCKET_NAME || "").trim();
  if (!bucket || !objectKey) return null;
  try {
    const r2 = await getR2Client();
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    return await getSignedUrl(
      r2,
      new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
      { expiresIn: Math.min(Math.max(60, expiresInSeconds), 7 * 24 * 60 * 60) },
    );
  } catch (err: unknown) {
    console.warn("[r2-presign-read] failed:", (err as { message?: string })?.message || err);
    return null;
  }
}
