import { describe, expect, it } from "vitest";
import { webOrigins } from "../src/web-origins";

describe("origens do painel (CORS)", () => {
  it("usa só o WEB_URL quando não há lista extra", () => {
    expect(webOrigins({ WEB_URL: "https://app.magobox.com.br/" } as any)).toEqual(["https://app.magobox.com.br"]);
  });
  it("soma as origens extras, sem barra final, espaços nem repetição", () => {
    expect(webOrigins({ WEB_URL: "https://app.magobox.com.br", WEB_ORIGINS: " https://www.magobox.com.br/ , https://app.magobox.com.br,, https://web-production-0bb3d.up.railway.app" } as any)).toEqual([
      "https://app.magobox.com.br",
      "https://www.magobox.com.br",
      "https://web-production-0bb3d.up.railway.app",
    ]);
  });
  it("em desenvolvimento cai no localhost", () => {
    expect(webOrigins({} as any)).toEqual(["http://localhost:3000"]);
  });
});
