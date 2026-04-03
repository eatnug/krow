declare module "node:fs" {
  export const promises: {
    mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
    writeFile(path: string, data: string): Promise<void>;
    readFile(path: string, encoding: string): Promise<string>;
  };
}

declare module "node:path" {
  export function resolve(...paths: string[]): string;
  export function join(...paths: string[]): string;
  export function dirname(path: string): string;

  const pathModule: {
    resolve: typeof resolve;
    join: typeof join;
    dirname: typeof dirname;
  };

  export default pathModule;
}

declare const process: {
  argv: string[];
  exitCode?: number;
  cwd(): string;
  stdout: { write(chunk: string): void };
  stderr: { write(chunk: string): void };
};
