import { definePage } from 'solid-file-router'
export default definePage((props) => {
  return <div>{JSON.stringify(props)}</div>
})
