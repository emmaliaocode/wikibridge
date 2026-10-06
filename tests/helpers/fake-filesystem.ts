export type FakeFile = {
  bytes: Uint8Array;
};

export type FakeTree = {
  [name: string]: FakeFile | FakeTree;
};

function isFile(x: FakeFile | FakeTree): x is FakeFile {
  return (x as FakeFile).bytes instanceof Uint8Array;
}

export class FakeFileHandle {
  readonly kind = "file" as const;
  constructor(
    readonly name: string,
    private data: Uint8Array,
  ) {}
  async getFile() {
    const bytes = this.data;
    return {
      name: this.name,
      size: bytes.byteLength,
      async arrayBuffer(): Promise<ArrayBuffer> {
        const copy = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(copy).set(bytes);
        return copy;
      },
      async text() {
        return new TextDecoder().decode(bytes);
      },
    };
  }
}

export class FakeDirectoryHandle {
  readonly kind = "directory" as const;
  constructor(
    readonly name: string,
    private tree: FakeTree,
  ) {}

  async *entries(): AsyncGenerator<
    [string, FakeFileHandle | FakeDirectoryHandle]
  > {
    for (const [name, value] of Object.entries(this.tree)) {
      if (isFile(value)) yield [name, new FakeFileHandle(name, value.bytes)];
      else yield [name, new FakeDirectoryHandle(name, value)];
    }
  }

  async getFileHandle(name: string): Promise<FakeFileHandle> {
    const v = this.tree[name];
    if (!v || !isFile(v)) throw new Error(`no file: ${name}`);
    return new FakeFileHandle(name, v.bytes);
  }

  async getDirectoryHandle(name: string): Promise<FakeDirectoryHandle> {
    const v = this.tree[name];
    if (!v || isFile(v)) throw new Error(`no directory: ${name}`);
    return new FakeDirectoryHandle(name, v);
  }
}

export function makeDir(name: string, tree: FakeTree): FakeDirectoryHandle {
  return new FakeDirectoryHandle(name, tree);
}

export function makeFile(
  name: string,
  contents: string | Uint8Array,
): FakeFileHandle {
  const bytes =
    typeof contents === "string"
      ? new TextEncoder().encode(contents)
      : contents;
  return new FakeFileHandle(name, bytes);
}
