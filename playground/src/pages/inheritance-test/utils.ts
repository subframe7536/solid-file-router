export const fetchMockData = async (): Promise<string> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 3000)
  })
  return '🎉 Data loaded (3s)'
}
