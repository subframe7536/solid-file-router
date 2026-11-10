import { useLocation } from '@solidjs/router'
import { definePage } from 'solid-file-router'

export default definePage((props) => {
  return (
    <>
      <div>nest layout useLocation() 's pathname: {useLocation().pathname}</div>
      <div>nest layout props.location.pathname: {props.location.pathname}</div>
      <div>nest layout props.children: {props.children}</div>
    </>
  )
})
