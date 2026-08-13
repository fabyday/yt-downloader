import type { ReturnCode, ReturnCodeType } from "../../Common/RetCode";

export abstract class BaseManager<
  TReturnType extends ReturnCodeType,
  TInitializeData = never,
  TFinalizeData = never,
> {
  abstract initialize(): Promise<ReturnCode<TReturnType, TInitializeData>>;
  abstract finalize(): Promise<ReturnCode<TReturnType, TFinalizeData>>;
}
