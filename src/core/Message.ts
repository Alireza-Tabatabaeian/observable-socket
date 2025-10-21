import {StatusCodes} from '.'


export type NullTypes = null | undefined
export type SimpleDataTypes = string | number | boolean
export type BasicDataTypes = SimpleDataTypes | NullTypes
export type ComplexTypes = SimpleDataTypes[] | Record<string, any> | ComplexTypes[]
export type Data = BasicDataTypes | ComplexTypes

export class Message<T = Data> {
    headers?: Record<string, unknown>
    uuid: string = ""
    route: string | null
    payload: T
    status: StatusCodes

    constructor(
        route: string,
        payload: T,
        headers: Record<string, unknown> | undefined = undefined,
        status: StatusCodes = StatusCodes.OK,
        uuid: string | null = null
    ) {
        this.route = route
        this.headers = headers
        this.payload = payload
        this.status = status
        this.uuid = uuid ? uuid : crypto.randomUUID()
    }

    serialize = (): string => {
        return JSON.stringify(this)
    }
}