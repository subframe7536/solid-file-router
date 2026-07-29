import { useLocation } from '@solidjs/router'
import { createRoute } from 'solid-file-router'

export default createRoute({
  component: (props) => {
    return (
      <>
        <div>nest layout useLocation() 's pathname: {useLocation().pathname}</div>
        <div>nest layout props.location.pathname: {props.location.pathname}</div>
        <div>nest layout props.children: {props.children}</div>
      </>
    )
  },
})
