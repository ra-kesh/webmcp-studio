import { z } from "zod"
import {
  documentCommandSchema,
  documentSchema,
  sceneNodeSchema,
  type Document,
  type DocumentCommand,
  type SceneNode,
} from "./schema"
import {
  sceneTransactionSchema,
  SCENE_TRANSACTION_MAX_BYTES,
  SCENE_TRANSACTION_MAX_COMMANDS,
  SCENE_TRANSACTION_VERSION,
  type SceneTransaction,
} from "./scene-transactions"

export const PUBLIC_SCENE_SCHEMA_VERSION = 1 as const

export type PublicSceneSchemaName =
  "transaction" | "command" | "node" | "document"

const schemas = {
  transaction: sceneTransactionSchema,
  command: documentCommandSchema,
  node: sceneNodeSchema,
  document: documentSchema,
} satisfies Record<PublicSceneSchemaName, z.ZodType>

export type PublicSceneSchemaValue =
  SceneTransaction | DocumentCommand | SceneNode | Document

/** Returns JSON Schema derived directly from the canonical runtime schema. */
export function readPublicSceneSchema(name: PublicSceneSchemaName) {
  return {
    schemaVersion: PUBLIC_SCENE_SCHEMA_VERSION,
    name,
    transactionVersion: SCENE_TRANSACTION_VERSION,
    limits: {
      maxTransactionBytes: SCENE_TRANSACTION_MAX_BYTES,
      maxCommandsPerTransaction: SCENE_TRANSACTION_MAX_COMMANDS,
    },
    schema: z.toJSONSchema(schemas[name], {
      target: "draft-7",
      reused: "ref",
    }),
  }
}
