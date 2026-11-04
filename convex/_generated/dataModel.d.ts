/* eslint-disable */
import type { GenericId } from "convex/values";
export type Id<TableName extends string> = GenericId<TableName>;
export type Doc<TableName extends string> = Record<string, unknown> & {
  _id: Id<TableName>;
  _creationTime: number;
};
export type DataModel = Record<string, unknown>;
