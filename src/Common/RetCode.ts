export type ReturnCodeType = string | number;

interface ReturnCodeBase<TReturnType extends ReturnCodeType> {
  readonly code: TReturnType;
  readonly message: string;
}

type ReturnCodeData<TData> = [TData] extends [never]
  ? { readonly data?: never }
  : { readonly data: TData };

/**
 * `ReturnCode<AreaReturnType>` keeps an area's code enum while sharing one
 * result shape. Add the second generic only when a successful result has data:
 * `ReturnCode<AreaReturnType, AreaData>`.
 */
export type ReturnCode<
  TReturnType extends ReturnCodeType,
  TData = never,
> =
  | (ReturnCodeBase<TReturnType> &
      ReturnCodeData<TData> & {
        readonly ok: true;
      })
  | (ReturnCodeBase<TReturnType> & {
      readonly detail?: string;
      readonly ok: false;
    });

export function successReturnCode<TReturnType extends ReturnCodeType>(
  code: TReturnType,
  message: string,
): ReturnCode<TReturnType>;
export function successReturnCode<
  TReturnType extends ReturnCodeType,
  TData,
>(
  code: TReturnType,
  message: string,
  data: TData,
): ReturnCode<TReturnType, TData>;
export function successReturnCode<
  TReturnType extends ReturnCodeType,
  TData,
>(
  code: TReturnType,
  message: string,
  ...data: [] | [TData]
): ReturnCode<TReturnType, TData> {
  return (data.length === 0
    ? { code, message, ok: true }
    : { code, data: data[0], message, ok: true }) as unknown as ReturnCode<
    TReturnType,
    TData
  >;
}

export function failureReturnCode<
  TReturnType extends ReturnCodeType,
  TData = never,
>(
  code: TReturnType,
  message: string,
  detail?: string,
): ReturnCode<TReturnType, TData> {
  return {
    code,
    ...(detail ? { detail } : {}),
    message,
    ok: false,
  };
}

export function getReturnCodeMessage(result: {
  readonly code: ReturnCodeType;
  readonly detail?: string;
  readonly message: string;
  readonly ok: boolean;
}): string {
  return result.ok || !result.detail
    ? `[${String(result.code)}] ${result.message}`
    : `[${String(result.code)}] ${result.message}\n${result.detail}`;
}
