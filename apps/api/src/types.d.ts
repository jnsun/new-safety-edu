import type { Principal } from "./auth.js";

declare module "fastify" {
  interface FastifyRequest {
    principal: Principal | null;
  }
}
