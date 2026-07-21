/** Minimal WebGPU typings used by compatibility detection. */
interface GPUAdapterInfo {
  device?: string;
  description?: string;
  vendor?: string;
}

interface GPUAdapter {
  info?: GPUAdapterInfo;
  features?: { has?: (name: string) => boolean };
}

interface GPU {
  requestAdapter(): Promise<GPUAdapter | null>;
}
