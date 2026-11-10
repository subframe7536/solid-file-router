export const route = {
  preload: () => {
    return 123
  },
}

export default (props: any): any => {
  return <div>data: {JSON.stringify(props.data)}</div>
}
