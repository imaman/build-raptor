declare const Trademark: unique symbol
export type Brand<BaseType, Name> = BaseType & { [Trademark]: Name }
