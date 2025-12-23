module.exports = {
  loadDynamically: moduleName => {
    return require(moduleName)
  },
  loadEsm: async moduleName => {
    return await import(moduleName)
  },
}
