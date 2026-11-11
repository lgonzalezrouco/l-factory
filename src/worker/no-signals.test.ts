import { fileURLToPath } from "node:url";
import { API } from "typescript/unstable/sync";
import {
  isCallExpression,
  isIdentifier,
  isPropertyAccessExpression,
  type Node,
} from "typescript/unstable/ast";
import { expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const calledNames = (file: URL): Array<string> => {
  const api = new API({ cwd: repoRoot });
  try {
    const sourceFile = api
      .updateSnapshot({ openProject: `${repoRoot}/tsconfig.json` })
      .getProjects()[0]
      ?.program.getSourceFile(fileURLToPath(file));
    if (sourceFile === undefined) throw new Error(`${file.pathname} is not in the project`);
    const names: Array<string> = [];
    const visit = (node: Node): void => {
      if (isCallExpression(node)) {
        const callee = node.expression;
        if (isIdentifier(callee)) names.push(callee.text);
        if (isPropertyAccessExpression(callee)) names.push(callee.name.text);
      }
      node.forEachChild(visit);
    };
    sourceFile.forEachChild(visit);
    return names;
  } finally {
    api.close();
  }
};

it("keeps the ticket workflow free of signals, so a waiting ticket holds no open execution", () => {
  const called = calledNames(new URL("workflows.ts", import.meta.url));

  expect(called).toContain("proxyActivities");
  expect(called.filter((name) => name === "defineSignal" || name === "setHandler")).toEqual([]);
});
