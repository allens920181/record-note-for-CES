// Vite's ?url imports resolve to a string; pdfjs' worker entry has no types.
declare module '*?url' {
  const url: string
  export default url
}
