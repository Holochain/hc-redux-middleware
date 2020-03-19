import { Middleware, AnyAction } from 'redux'

type hcWebClientConnect = Promise<{
  call: (callStr: string) => (params: any) => Promise<string>,
  callZome: (instance: string, zome: string, func: string) => (params: any) => Promise<string>,
  close: () => Promise<any>,
  ws: any
}>

export const holochainMiddleware = (hcWc: hcWebClientConnect): Middleware => store => {
  // stuff here has the same life as the store!
  // this is how we persist a websocket connection

  const connectPromise = hcWc.then(({ call, callZome, ws }) => {
    ws.on('open', () => {
      store.dispatch({ type: 'HOLOCHAIN_WEBSOCKET_CONNECTED' })
    })

    ws.on('close', () => {
      store.dispatch({ type: 'HOLOCHAIN_WEBSOCKET_DISCONNECTED' })
    })

    return { call, callZome }
  })

  return next => (action: AnyAction) => {
    if (action.meta && (action.meta.holochainZomeCallAction || action.meta.holochainAdminAction)) {
      next(action) // resend the original action so the UI can change based on requests

      return connectPromise.then(({ call, callZome }) => {

        let callFunction
        if (action.meta.holochainZomeCallAction) {
          const { instanceId, zome, func } = action.meta
          callFunction = callZome(instanceId, zome, func)
        } else {
          callFunction = call(action.meta.callString)
        }

        return callFunction(action.payload)
          .then((rawResult: string) => {

            // holochain calls will strings (possibly stringified JSON)
            // while container admin calls will return parsed JSON
            let result
            try {
              result = JSON.parse(rawResult)
            } catch (e) {
              result = rawResult
            }

            if (result.Err !== undefined) { // holochain error
              store.dispatch({
                type: action.type + '_FAILURE',
                payload: result.Err
              })
              return Promise.reject(Error(result.Err))
            } else if (result.Ok !== undefined) { // holochain Ok
              store.dispatch({
                type: action.type + '_SUCCESS',
                payload: result.Ok
              })
              return result.Ok
            } else {                 // unknown. Return raw result as success
              store.dispatch({
                type: action.type + '_SUCCESS',
                payload: result
              })
              return result
            }
          })
          .catch((err: Error) => { // websocket error
            store.dispatch({
              type: action.type + '_FAILURE',
              payload: err
            })
            return Promise.reject(err)
          })
      })
    } else {
      return next(action)
    }
  }
}
