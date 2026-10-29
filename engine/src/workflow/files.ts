import type { FileStore } from "../check/types";

export function r2Files(bucket: R2Bucket): FileStore {
  return {
    async get(key) {
      const obj = await bucket.get(key);
      return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
    },
    async put(key, bytes, contentType) {
      await bucket.put(key, bytes, { httpMetadata: { contentType } });
    },
  };
}
