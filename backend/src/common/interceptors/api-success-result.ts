/**
 * 需要自定义成功响应 message 时，用它包裹返回值。
 *
 * 不包裹时 ResponseInterceptor 统一输出「请求成功」。
 * 例：发送验证码接口需要返回「如果该邮箱可以注册，验证码将发送至邮箱」这类
 * 不泄露账号存在性的固定提示。
 */
export class ApiSuccessResult<T> {
  constructor(
    readonly data: T,
    readonly message: string,
  ) {}
}
