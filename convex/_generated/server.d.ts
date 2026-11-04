/* eslint-disable */
import type {
  GenericActionCtx,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
} from "convex/server";
import {
  actionGeneric,
  httpActionGeneric,
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  mutationGeneric,
  queryGeneric,
} from "convex/server";

export declare const query: typeof queryGeneric;
export declare const mutation: typeof mutationGeneric;
export declare const action: typeof actionGeneric;
export declare const internalQuery: typeof internalQueryGeneric;
export declare const internalMutation: typeof internalMutationGeneric;
export declare const internalAction: typeof internalActionGeneric;
export declare const httpAction: typeof httpActionGeneric;
export type QueryCtx = GenericQueryCtx<GenericDataModel>;
export type MutationCtx = GenericMutationCtx<GenericDataModel>;
export type ActionCtx = GenericActionCtx<GenericDataModel>;
