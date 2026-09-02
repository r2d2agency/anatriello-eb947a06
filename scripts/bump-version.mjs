#!/usr/bin/env node
// Gera a versão do build a partir do horário atual (epoch, em segundos).
// Uso: node scripts/bump-version.mjs
//
// Por que não incrementar um contador salvo em public/version.json?
// O Docker build é efêmero — o bump acontecia dentro do container, nunca era
// commitado de volta pro git, então TODO build partia do mesmo valor commitado
// e chegava sempre no mesmo próximo número. Resultado: toda imagem nova gerava
// a mesma versão, o banner de atualização nunca via nada "mais novo", e os
// usuários ficavam presos no bundle antigo em cache mesmo com deploys novos no ar.
// Epoch sempre cresce, então cada build tem uma versão maior que a anterior sem
// precisar persistir estado nenhum.
import { writeFileSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const jsonPath = resolve(root, "public/version.json");
const tsPath = resolve(root, "src/version.ts");

const timestamp = Date.now();
const next = String(Math.floor(timestamp / 1000));

writeFileSync(jsonPath, JSON.stringify({ version: next, timestamp }, null, 2) + "\n");

const ts = readFileSync(tsPath, "utf8").replace(
  /APP_VERSION\s*=\s*"[^"]+"/,
  `APP_VERSION = "${next}"`,
);
writeFileSync(tsPath, ts);

console.log(`Version set: ${next}`);
