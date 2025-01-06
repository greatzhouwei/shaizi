// app.js
App({
  onLaunch: function () {
    // 处理未捕获的Promise错误
    wx.onUnhandledRejection(({ reason }) => {
      console.error('未处理的Promise错误:', reason)
    })

    // 处理全局错误
    wx.onError((error) => {
      console.error('全局错误:', error)
    })

    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
    } else {
      wx.cloud.init({
        env: 'duoduowu-9g5xj9o59b6811b5',
        traceUser: true,
      })
    }
    
    // 创建游戏集合
    const db = wx.cloud.database()
    const games = db.collection('games')

    // 添加 WebSocket 错误处理
    wx.onSocketError(function (res) {
      console.error('WebSocket 错误:', res)
    })

    wx.onSocketClose(function (res) {
      console.log('WebSocket 已关闭:', res)
    })
  },

  // 全局错误处理
  onError(error) {
    console.error('应用错误:', error)
  },

  // 全局数据
  globalData: {
    userInfo: null
  }
})
