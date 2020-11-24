## Data Store

A lightweight state management framework with support of React Hook.

### Example

~~~js
import { dataStore } from './data_store'

dataStore.initDataStore({
  data: {
    uuid: null,
    visitUrl: 'http://127.0.0.1:8000'
  },
  selectors: ['selector::formatted_uuid']
})

dataStore.defineSelector('selector::formatted_uuid', ['uuid'], (uuid) => {
  return `UUID-${uuid}-${Date.now()}`
})


const App = () => {
  const [
    {
      uuid: [uuid, setUuid],
      visitUrl: [visitUrl, setVisitUrl],
      'selector::formatted_uuid': [formattedUuid]
    },
    initStateHook,
    clearStateHook
  ] = dataStore.bindStateHook(React, ['uuid', 'visitUrl', 'selector::formatted_uuid'])

  React.useEffect(() => {
    initStateHook()
    return () => clearStateHook()
  }, [])

  return (
      <div>
        <p>UUID: { formattedUuid }</p>
        <p>{visitUrl}</p>
      </div>
  )
}
~~~