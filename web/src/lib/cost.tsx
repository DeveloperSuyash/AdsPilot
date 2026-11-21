// Cost is for the administrator. Every other person sees what a screen does, never what it costs us.
// A context rather than a module flag, so a screen that rendered before the app knew who was signed in
// corrects itself the moment it does.
import { createContext, useContext } from 'react'

const Ctx = createContext(false)
export const CostProvider = Ctx.Provider
export const useCostVisible = () => useContext(Ctx)
