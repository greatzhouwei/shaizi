// index.js
const db = wx.cloud.database()
Page({
  data: {
    gameId: '',
    playerId: '',
    player1Dice: [],
    player2Dice: [],
    currentPlayer: 1,
    lastCall: {
      count: 0,
      value: 0
    },
    gameStatus: 'ready',
    buttonDisabled: false,
    currentCall: {
      count: 0,
      value: 0
    },
    diceImages: [
      '/assets/images/骰子1.png',
      '/assets/images/骰子2.png',
      '/assets/images/骰子3.png',
      '/assets/images/骰子4.png',
      '/assets/images/骰子5.png',
      '/assets/images/骰子6.png'
    ],
    numberWords: ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'],
    diceNumbers: ['1', '2', '3', '4', '5', '6'],
    selectedCount: 1,
    selectedValue: 1,
    showResult: false,
    actualCount: 0,
    myDice: [], // 当前玩家的骰子
    isPlayer1: false, // 是否是玩家1
    watcher: null,  // 添加 watcher 属性
    waitingText: '', // 添加等待提示文本
    currentTurn: '',  // 添加当前回合提示
    reconnectCount: 0,
    maxReconnectCount: 5,
    callHistory: [],  // 添加历史记录数组
  },

  onLoad() {
    this.initGame()
  },

  // 添加页面卸载时的清理
  onUnload() {
    if (this.data.watcher) {
      try {
        this.data.watcher.close()
      } catch (error) {
        console.log('关闭监听器失败:', error)
      }
    }

    // 清理游戏状态
    if (this.data.gameId) {
      db.collection('games').doc(this.data.gameId).update({
        data: {
          status: 'ended'
        }
      }).catch(error => {
        console.log('更新游戏状态失败:', error)
      })
    }
  },

  // 初始化游戏
  async initGame() {
    try {
      // 修改云函数调用方式
      const { result } = await wx.cloud.callFunction({
        name: 'getOpenId',
        data: {}
      })
      console.log('云函数调用结果：', result)
      const openid = result.openid

      // 先清理旧的游戏记录
      try {
        await db.collection('games')
          .where({
            $or: [
              { player1: openid },
              { player2: openid }
            ]
          })
          .remove()
      } catch (error) {
        console.log('清理旧游戏记录:', error)
      }

      // 查找等待中的游戏
      let game = await db.collection('games')
        .where({
          status: 'waiting',
          player1: db.command.neq(openid) // 确保不是自己创建的游戏
        })
        .limit(1)
        .get()

      if (game.data.length === 0) {
        // 创建新游戏
        const gameData = {
          player1: openid,
          player2: '',
          status: 'waiting',
          player1Dice: [],
          player2Dice: [],
          currentPlayer: 1,
          lastCall: { count: 0, value: 0 },
          gameStatus: 'ready',
          createTime: db.serverDate(),
          callHistory: []  // 初始化空的历史记录数组
        }
        const res = await db.collection('games').add({
          data: gameData
        })
        this.setData({
          gameId: res._id,
          playerId: openid,
          isPlayer1: true
        })

        // 添加提示
        wx.showToast({
          title: '等待其他玩家加入...',
          icon: 'none',
          duration: 2000
        })
      } else {
        // 加入现有游戏
        const gameId = game.data[0]._id
        await db.collection('games').doc(gameId).update({
          data: {
            player2: openid,
            status: 'playing',
            gameStatus: 'ready'
          }
        })
        this.setData({
          gameId: gameId,
          playerId: openid,
          isPlayer1: false
        })

        // 添加提示
        wx.showToast({
          title: '游戏开始！',
          icon: 'success',
          duration: 1500
        })
      }

      // 监听游戏状态变化
      this.watchGameChanges()
    } catch (error) {
      console.error('初始化游戏失败：', error)
      wx.showToast({
        title: '初始化失败，请重试',
        icon: 'none',
        duration: 2000
      })
    }
  },

  // 修改错误处理方法
  handleError(error, context) {
    console.error(`${context}发生错误:`, error)
    
    // 不是重连相关的错误才显示提示
    if (!error.message?.includes('realtime listener')) {
      wx.showToast({
        title: '操作失败，请重试',
        icon: 'none',
        duration: 2000
      })
    }
  },

  // 修改监听游戏变化方法
  watchGameChanges() {
    try {
      // 先关闭已存在的监听器
      if (this.data.watcher) {
        try {
          this.data.watcher.close()
        } catch (error) {
          console.log('关闭旧监听器失败:', error)
        }
      }

      const watcher = db.collection('games')
        .doc(this.data.gameId)
        .watch({
          onChange: (snapshot) => {
            try {
              // 重置重连计数
              this.setData({ reconnectCount: 0 })

              if (!snapshot || !snapshot.docs || !snapshot.docs[0]) {
                console.error('无效的快照数据:', snapshot)
                return
              }
              
              const data = snapshot.docs[0]
              const oldLastCall = this.data.lastCall
              
              // 更新游戏状态
              this.setData({
                currentPlayer: data.currentPlayer || 1,
                gameStatus: data.gameStatus || 'ready',
                lastCall: data.lastCall || { count: 0, value: 0 },
                showResult: data.showResult || false,
                actualCount: data.actualCount || 0,
                myDice: this.data.isPlayer1 ? (data.player1Dice || []) : (data.player2Dice || []),
                waitingText: data.status === 'waiting' ? '等待其他玩家加入...' : '',
                currentTurn: this.getCurrentTurnText(data),
                callHistory: data.callHistory || []  // 更新历史记录
              })

              // 如果lastCall发生变化，添加到历史记录
              if (data.lastCall && 
                  (data.lastCall.count !== oldLastCall.count || 
                   data.lastCall.value !== oldLastCall.value)) {
                const playerText = data.currentPlayer === 1 ? '玩家二' : '玩家一'
                wx.showToast({
                  title: `${playerText}：${this.data.numberWords[data.lastCall.count-1]}个${data.lastCall.value}点`,
                  icon: 'none',
                  duration: 2000
                })
              }

              // 在游戏结束时显示所有骰子
              if (data.showResult) {
                this.setData({
                  player1Dice: data.player1Dice || [],
                  player2Dice: data.player2Dice || []
                })
              }
            } catch (error) {
              this.handleError(error, '监听数据处理')
            }
          },
          onError: (err) => {
            this.handleError(err, '监听游戏')
            // 尝试重连
            this.tryReconnect()
          }
        })

      // 保存监听器引用
      this.setData({
        watcher: watcher
      })
    } catch (error) {
      this.handleError(error, '设置监听器')
      // 尝试重连
      this.tryReconnect()
    }
  },

  // 添加获取当前回合提示文本的方法
  getCurrentTurnText(gameData) {
    if (gameData.status !== 'playing') return ''
    
    const isMyTurn = (this.data.isPlayer1 && gameData.currentPlayer === 1) || 
                    (!this.data.isPlayer1 && gameData.currentPlayer === 2)
    
    if (gameData.gameStatus === 'ready') {
      return isMyTurn ? '轮到你投掷骰子' : '等待对方投掷骰子'
    } else if (gameData.gameStatus === 'playing') {
      return isMyTurn ? '轮到你叫数' : '等待对方叫数'
    }
    return ''
  },

  // 修改投掷骰子方法
  async rollDice() {
    if (this.data.currentPlayer !== (this.data.isPlayer1 ? 1 : 2)) {
      wx.showToast({
        title: '还没轮到你',
        icon: 'none'
      })
      return
    }

    let diceResults = [];
    for (let i = 0; i < 5; i++) {
      diceResults.push(Math.floor(Math.random() * 6) + 1);
    }
    diceResults.sort((a, b) => a - b);

    const updateData = {}
    if (this.data.isPlayer1) {
      updateData.player1Dice = diceResults
      updateData.currentPlayer = 2
    } else {
      updateData.player2Dice = diceResults
      updateData.currentPlayer = 1
      updateData.gameStatus = 'playing'
    }

    try {
      await db.collection('games').doc(this.data.gameId).update({
        data: updateData
      })
    } catch (error) {
      console.error('投掷骰子失败：', error)
    }
  },

  // 添加 picker 的值变化处理方法
  bindPickerChange(e) {
    const values = e.detail.value
    this.setData({
      selectedCount: values[0] + 1,  // 因为数组索引从0开始，所以要加1
      selectedValue: parseInt(this.data.diceNumbers[values[1]])
    })
  },

  // 修改叫数方法
  async makeCall() {
    if (this.data.currentPlayer !== (this.data.isPlayer1 ? 1 : 2)) {
      wx.showToast({
        title: '还没轮到你',
        icon: 'none'
      })
      return
    }

    const { selectedCount, selectedValue } = this.data
    
    // 检查是否已选择数值
    if (!selectedCount || !selectedValue) {
      wx.showToast({
        title: '请选择数量和点数',
        icon: 'none'
      })
      return
    }

    if (!this.validateCall(selectedCount, selectedValue)) {
      wx.showToast({
        title: '叫数无效！数量不能减少，数量相同时点数必须增加',
        icon: 'none',
        duration: 2000
      })
      return
    }

    try {
      // 先获取当前游戏数据
      const game = await db.collection('games').doc(this.data.gameId).get()
      const currentHistory = game.data.callHistory || []
      const playerText = this.data.isPlayer1 ? '玩家一' : '玩家二'
      const callText = `${this.data.numberWords[selectedCount-1]}个${selectedValue}点`
      
      // 构建新的历史记录
      const newHistory = [...currentHistory]
      if (this.data.isPlayer1) {
        newHistory.push({ player: 1, text: callText })
      } else {
        newHistory.push({ player: 2, text: callText })
      }

      // 更新数据库
      await db.collection('games').doc(this.data.gameId).update({
        data: {
          lastCall: {
            count: selectedCount,
            value: selectedValue
          },
          currentPlayer: this.data.currentPlayer === 1 ? 2 : 1,
          gameStatus: 'playing',
          callHistory: newHistory
        }
      })

    } catch (error) {
      console.error('叫数失败：', error)
      wx.showToast({
        title: '叫数失败，请重试',
        icon: 'none'
      })
    }
  },

  // 添加验证叫数的方法
  validateCall(count, value) {
    const lastCall = this.data.lastCall
    if (lastCall.count === 0) return true // 第一次叫数

    // 数量必须增加，或者数量相同时点数必须增加
    return count > lastCall.count || (count === lastCall.count && value > lastCall.value)
  },

  // 修改质疑方法
  async challenge() {
    try {
      const game = await db.collection('games').doc(this.data.gameId).get()
      const allDice = [...game.data.player1Dice, ...game.data.player2Dice]
      const {count, value} = game.data.lastCall
      
      let actualCount = allDice.filter(dice => 
        dice === value || dice === 1
      ).length

      await db.collection('games').doc(this.data.gameId).update({
        data: {
          gameStatus: 'ended',
          showResult: true,
          actualCount: actualCount
        }
      })
    } catch (error) {
      console.error('质疑失败：', error)
    }
  },

  // 修改重新开始方法
  async restart() {
    try {
      await db.collection('games').doc(this.data.gameId).update({
        data: {
          player1Dice: [],
          player2Dice: [],
          currentPlayer: 1,
          lastCall: {
            count: 0,
            value: 0
          },
          gameStatus: 'ready',
          showResult: false,
          actualCount: 0,
          callHistory: []  // 清空历史记录
        }
      })

      // 本地也清空历史记录
      this.setData({
        callHistory: []
      })

      wx.showToast({
        title: '游戏已重新开始',
        icon: 'success',
        duration: 1500
      })
    } catch (error) {
      console.error('重新开始失败：', error)
      wx.showToast({
        title: '重新开始失败',
        icon: 'none'
      })
    }
  },

  // 添加重连方法
  tryReconnect() {
    if (this.data.reconnectCount >= this.data.maxReconnectCount) {
      wx.showToast({
        title: '连接失败，请重新进入游戏',
        icon: 'none',
        duration: 2000
      })
      return
    }

    this.setData({
      reconnectCount: this.data.reconnectCount + 1
    })

    setTimeout(() => {
      console.log(`第${this.data.reconnectCount}次重试连接...`)
      this.watchGameChanges()
    }, 1000 * Math.min(this.data.reconnectCount, 5)) // 最多等待5秒
  },

  // 添加计算按钮是否禁用的方法
  isButtonDisabled() {
    const isMyTurn = (this.data.isPlayer1 && this.data.currentPlayer === 1) || 
                     (!this.data.isPlayer1 && this.data.currentPlayer === 2);
    return this.data.gameStatus !== 'ready' || !isMyTurn;
  }
})
