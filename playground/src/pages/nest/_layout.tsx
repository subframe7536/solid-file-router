import { useLocation } from '@solidjs/router'

export default (props: any): any => {
  return (
    <>
      <div>nest layout useLocation() 's pathname: {useLocation().pathname}</div>
      <div>nest layout props.location.pathname: {props.location.pathname}</div>
      <div>nest layout props.children: {props.children}</div>
    </>
  )
}
