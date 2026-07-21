/** Join a directory and name into a POSIX-style workspace path. */
export function joinPath(dir: string, name: string): string {
  if (dir === "/") return `/${name}`;
  return `${dir}/${name}`;
}

/** Breadcrumb segments for a workspace directory path. */
export function breadcrumbs(dir: string): { name: string; path: string }[] {
  const crumbs = [{ name: "Workspace", path: "/" }];
  if (dir === "/") return crumbs;

  const parts = dir.split("/").filter(Boolean);
  let acc = "";
  for (const part of parts) {
    acc += `/${part}`;
    crumbs.push({ name: part, path: acc });
  }
  return crumbs;
}

/** Resolve a relative or absolute path against a cwd. */
export function resolvePath(cwd: string, arg?: string): string {
  if (!arg) return cwd;
  if (arg.startsWith("/")) return arg;
  return joinPath(cwd, arg);
}
