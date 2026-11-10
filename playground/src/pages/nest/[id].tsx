import { definePage } from 'solid-file-router'
export const route = {
  preload: () => {
    return 123
  },
}

export default definePage((props) => {
  return <div>data: {JSON.stringify(props.data)}</div>
})
