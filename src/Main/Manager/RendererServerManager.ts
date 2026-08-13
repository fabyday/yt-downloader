import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import {
  failureReturnCode,
  successReturnCode,
  type ReturnCode,
} from "../../Common/RetCode";
import { BaseManager } from "./BaseManager";
import { RendererServerReturnType } from "./ReturnTypes";

export interface RendererServerInfo {
  readonly server: http.Server;
  readonly url: string;
}

export class RendererServerManager extends BaseManager<
  RendererServerReturnType,
  RendererServerInfo
> {
  private rendererServer: RendererServerInfo | null = null;

  async initialize(): Promise<
    ReturnCode<RendererServerReturnType, RendererServerInfo>
  > {
    if (this.rendererServer) {
      return successReturnCode(
        RendererServerReturnType.Initialized,
        "Renderer server is already running",
        this.rendererServer,
      );
    }

    try {
      const rendererRoot = path.join(__dirname, "../renderer");
      const server = http.createServer((request, response) => {
        serveRendererFile(rendererRoot, request, response);
      });
      const url = await listen(server);
      this.rendererServer = { server, url };
      return successReturnCode(
        RendererServerReturnType.Initialized,
        "Renderer server initialized",
        this.rendererServer,
      );
    } catch (error) {
      return failureReturnCode(
        RendererServerReturnType.InitializationFailed,
        "Renderer server initialization failed",
        getErrorMessage(error),
      );
    }
  }

  async finalize(): Promise<ReturnCode<RendererServerReturnType>> {
    const current = this.rendererServer;
    this.rendererServer = null;
    if (!current) {
      return successReturnCode(
        RendererServerReturnType.Finalized,
        "Renderer server is already stopped",
      );
    }

    try {
      await closeServer(current.server);
      return successReturnCode(
        RendererServerReturnType.Finalized,
        "Renderer server finalized",
      );
    } catch (error) {
      return failureReturnCode(
        RendererServerReturnType.FinalizationFailed,
        "Renderer server finalization failed",
        getErrorMessage(error),
      );
    }
  }
}

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not determine the renderer server address"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}/index.html`);
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function serveRendererFile(
  rendererRoot: string,
  request: http.IncomingMessage,
  response: http.ServerResponse,
): void {
  const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }

  const resolvedPath = path.resolve(rendererRoot, `.${decodedPathname}`);
  const relativePath = path.relative(rendererRoot, resolvedPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(resolvedPath, (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500);
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": getContentType(resolvedPath),
    });
    response.end(content);
  });
}

function getContentType(filePath: string): string {
  switch (path.extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "");
}
