/**
 * Checks, at compile time, that a certain situation cannot happen (and fail the build if it can). This is useful for
 * checking that all possible cases of a union type are handled.
 *
 * Typical usage pattern:
 *
 *   type X = 'A' | 'B'
 *
 *   function f(x: X) {
 *     if (x === 'a') {
 *       // do something ...
 *       return
 *     }
 *     if (x === 'b') {
 *       // do something ...
 *       return
 *     }
 *     shouldNeverHappen(x)
 *   }
 *
 *
 * If we ever change X such that it has a third case (as in `type X = 'A' | 'B' | 'C') we will get a compile error
 * unless we add logic to this function (`f()`) to handle it.
 *
 * @param n a value of type `never`
 */
export function shouldNeverHappen(n: never): never {
  // This following line never gets executed. It is here just to make the compiler happy.
  throw new Error(`This should never happen ${n}`)
}

/**
 * An always-failing function. If it ever gets called, it will throw an error. It is useful in conditional expressions
 * in which one of the branches of the expression is the happy path, and the other branch is a sad path in which no
 * value can be computed. Sepcifically, it usually appears as the right-hand-side operand of `??` or `||` expressions.
 *
 * Typical usage pattern:
 *
 *    const dir: string = process.env['WORKING_DIR'] || failMe('missing env variable "a"')
 *
 * Essentially, this is a concise alternative to:
 *
 *    const dir = process.env['a']
 *    if (!dir) {
 *      throw new Error('missing env variable "a"')
 *    }
 *
 * @param hint an optional human-readable string to be placed in the message of the thrown error
 */
export function failMe(hint?: string): never {
  if (!hint) {
    throw new Error(`This expression must never be evaluated`)
  }

  throw new Error(`Bad value: ${hint}`)
}

/**
 * Evaluates just one of several functions (the `cases` parameter) based on the `selector` value passed in.
 * `cases` is a record of zero-argument functions. The function at `cases[selector]` will be evaluated and its return
 * value is returned back to the caller.
 *
 * A compile time error is produced if not all possible values of `selector` are covered by `cases`.
 *
 * Example:
 *    function f(op: '+' | '-' | '*', n1: number, n2: number) {
 *      return switchOn(op, {
 *        '+': () => n1 + n2,
 *        '-': () => n1 - n2,
 *        '*': () => n1 * n2,
 *      })
 *    }
 *
 *
 * The following snippet yields a compile-time error:
 *
 *    function f(op: '+' | '-' | '*', n1: number, n2: number) {
 *      return switchOn(op, {
 *        '+': () => n1 + n2,
 *        '-': () => n1 - n2,
 *      })   // <-- Compiler error here due to missing case ('*')
 *    }
 *
 * And so does this:
 *
 *    function f(op: '+' | '-' | '*', n1: number, n2: number) {
 *      return switchOn(op, {
 *        '+': () => n1 + n2,
 *        '-': () => n1 - n2,
 *        '*': () => n1 - n2,
 *        '/': () => n1 / n2,
 *      })   // <-- Compiler error here due to extraneous case ('/')
 *    }
 *
 * @param selector
 * @param cases
 * @returns
 */
export function switchOn<G, K extends string>(selector: K, cases: Record<K, () => G>): G {
  const f = cases[selector]
  return f()
}

/**
 * Safely converts an input of type `unknown` into an Error like object. The return value will contain `message`
 * and `stack` properties which will be strings (if a corresponding propertiy of type string exists on the input) or
 * undefined (otherwise)
 *
 * @param err an input of type `unknown`
 * @returns an Error like object
 */
export function errorLike(err: unknown): { message: string | undefined; stack: string | undefined } {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const { message, stack } = err as { message?: unknown; stack?: unknown }
  return {
    message: typeof message === 'string' ? message : undefined,
    stack: typeof stack === 'string' ? stack : undefined,
  }
}

/**
 * Generates a two-tuple from the arguments passed in. Useful in situations where the compiler fails to infer that
 * `[foo, bar]` is a tuple and treats it like an array. Using `pair(foo, bar)` will make the compiler correctly infer
 * the tuple type.
 */
export function pair<A, B>(a: A, b: B): [A, B] {
  return [a, b]
}
