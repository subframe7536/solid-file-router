export const fetchMockData = async () => {
  await new Promise((resolve) => setTimeout(resolve, 3000))
  return '🎉 Data loaded (3s)'
}
