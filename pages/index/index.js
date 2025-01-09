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
    player1Wins: 0,  // 玩家一胜利次数
    player2Wins: 0,  // 玩家二胜利次数
    isButtonLocked: false,  // 添加按钮锁定状态
    isRolling: false,
    audioContext: null
  },

  onLoad() {
    this.initGame()
    this.setData({
      audioContext: wx.createInnerAudioContext()
    })
    this.data.audioContext.src = '/assets/sound/dice_shake-96201.mp3'
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
      // 重置状态
      this.setData({
        reconnectCount: 0,
        waitingText: '正在初始化游戏...'
      })

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
          callHistory: [],  // 初始化空的历史记录数组
          player1Wins: 0,   // 初始化玩家一胜利次数
          player2Wins: 0    // 初始化玩家二胜利次数
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
      wx.showModal({
        title: '初始化失败',
        content: '是否重试？',
        success: (res) => {
          if (res.confirm) {
            this.initGame()
          } else {
            wx.navigateBack({
              delta: 1
            })
          }
        }
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

      // 确保 gameId 存在
      if (!this.data.gameId) {
        console.error('游戏ID不存在')
        this.initGame() // 重新初始化游戏
        return
      }

      const watcher = db.collection('games')
        .doc(this.data.gameId)
        .watch({
          onChange: (snapshot) => {
            try {
              if (!snapshot || !snapshot.docs || !snapshot.docs[0]) {
                console.error('无效的快照数据:', snapshot);
                return;
              }
              
              const data = snapshot.docs[0];
              
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
                callHistory: data.callHistory || [],
                winner: data.winner || null,
                player1Wins: data.player1Wins || 0,  // 从数据库更新玩家一胜利次数
                player2Wins: data.player2Wins || 0,  // 从数据库更新玩家二胜利次数
                player1Dice: data.player1Dice || [],
                player2Dice: data.player2Dice || []
              });

              // 如果游戏结束且有胜利方，显示提示
              if (data.gameStatus === 'ended' && data.winner) {
                wx.showModal({
                  title: '游戏结束',
                  content: `胜利方为玩家${data.winner}\n\n玩家一的骰子: ${data.player1Dice.join(', ')}\n玩家二的骰子: ${data.player2Dice.join(', ')}`,
                  showCancel: false
                });
              }
            } catch (error) {
              console.error('数据处理错误:', error);
              this.handleError(error, '监听数据处理');
            }
          },
          onError: (err) => {
            console.error('监听错误:', err)
            this.handleError(err, '监听游戏')
            this.tryReconnect()
          }
        })

      this.setData({ watcher })
    } catch (error) {
      console.error('设置监听器错误:', error)
      this.handleError(error, '设置监听器')
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
      });
      return;
    }

    // 播放音效
    this.data.audioContext.play();

    // 开始动画
    this.setData({ isRolling: true });

    // 生成最终的骰子结果
    let diceResults = [];
    for (let i = 0; i < 5; i++) {
      diceResults.push(Math.floor(Math.random() * 6) + 1);
    }
    diceResults.sort((a, b) => a - b);

    // 创建动画效果
    let count = 0;
    const animationInterval = setInterval(() => {
      const tempDice = [];
      for (let i = 0; i < 5; i++) {
        tempDice.push(Math.floor(Math.random() * 6) + 1);
      }
      this.setData({
        myDice: tempDice
      });
      count++;
      if (count > 10) { // 动画持续约500ms
        clearInterval(animationInterval);
        // 停止动画并显示最终结果
        setTimeout(() => {
          this.setData({ 
            isRolling: false,
            myDice: diceResults
          });

          // 更新数据库
          const updateData = {};
          if (this.data.isPlayer1) {
            updateData.player1Dice = diceResults;
            updateData.currentPlayer = 2;
            updateData.gameStatus = 'ready';
          } else {
            updateData.player2Dice = diceResults;
            updateData.currentPlayer = 1;
            updateData.gameStatus = 'ready';
          }

          db.collection('games').doc(this.data.gameId).update({
            data: updateData
          }).then(() => {
            // 如果双方都已投掷骰子，则更新游戏状态为playing
            return db.collection('games').doc(this.data.gameId).get();
          }).then(game => {
            if (game.data.player1Dice.length > 0 && game.data.player2Dice.length > 0) {
              return db.collection('games').doc(this.data.gameId).update({
                data: {
                  gameStatus: 'playing'
                }
              });
            }
          }).catch(error => {
            console.error('投掷骰子失败：', error);
          });
        }, 500);
      }
    }, 50);
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
    // 如果按钮已锁定，直接返回
    if (this.data.isButtonLocked) {
      return;
    }

    if (this.data.currentPlayer !== (this.data.isPlayer1 ? 1 : 2)) {
      wx.showToast({
        title: '还没轮到你',
        icon: 'none'
      });
      return;
    }

    const { selectedCount, selectedValue } = this.data;
    
    // 检查是否已选择数值
    if (!selectedCount || !selectedValue) {
      wx.showToast({
        title: '请选择数量和点数',
        icon: 'none'
      });
      return;
    }

    // 第一次叫数的验证提示
    if (this.data.lastCall.count === 0) {
      if (selectedValue === 1 && selectedCount < 2) {
        wx.showToast({
          title: '叫1时至少需要叫2个',
          icon: 'none',
          duration: 2000
        })
        return
      }
      if (selectedValue !== 1 && selectedCount < 3) {
        wx.showToast({
          title: '非1点数至少需要叫3个',
          icon: 'none',
          duration: 2000
        })
        return
      }
    }

    if (!this.validateCall(selectedCount, selectedValue)) {
      if (this.data.lastCall.value === 1) {
        wx.showToast({
          title: '上次叫的是1，只能增加数量',
          icon: 'none',
          duration: 2000
        })
      } else {
        wx.showToast({
          title: '叫数无效！需要增加数量或叫更大的点数',
          icon: 'none',
          duration: 2000
        })
      }
      return
    }

    // 锁定按钮
    this.setData({ isButtonLocked: true });

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
    } finally {
      // 延迟解锁按钮，防止快速连击
      setTimeout(() => {
        this.setData({ isButtonLocked: false });
      }, 1000); // 1秒后解锁
    }
  },

  // 修改验证叫数的方法
  validateCall(count, value) {
    const lastCall = this.data.lastCall;
    
    // 第一次叫数的特殊规则
    if (lastCall.count === 0) {
      // 如果是1点，可以两个起叫，否则必须三个起叫
      if (value === 1) {
        return count >= 2;
      } else {
        return count >= 3;
      }
    }

    // 处理后续叫数的规则
    if (lastCall.value === 1) {
      // 上一次叫的是1，新叫的数必须数量更多
      return count > lastCall.count;
    }

    if (value === 1) {
      // 当前叫1，数量可以和上次相同（因为1最大）
      return count >= lastCall.count;
    }

    // 检查是否有人叫过1
    const hasCalledOne = this.data.callHistory.some(call => 
      call.text.includes('1点')
    );

    // 如果已经叫过1，则1不能再当任何数使用
    if (hasCalledOne) {
      // 计算实际数量时不计入1点
      return count > lastCall.count || 
             (count === lastCall.count && value > lastCall.value);
    }

    // 其他情况：
    // 1. 数量必须增加，或者
    // 2. 数量相同时，新的点数必须大于旧的点数（除非旧的是1）
    return count > lastCall.count || 
           (count === lastCall.count && value > lastCall.value && lastCall.value !== 1);
  },

  // 修改质疑方法
  async challenge() {
    // 如果按钮已锁定，直接返回
    if (this.data.isButtonLocked) {
      return;
    }

    // 锁定按钮
    this.setData({ isButtonLocked: true });

    try {
      const game = await db.collection('games').doc(this.data.gameId).get();
      const player1Dice = game.data.player1Dice;
      const player2Dice = game.data.player2Dice;
      const { count, value } = game.data.lastCall;

      // 检查是否有人叫过1
      const hasCalledOne = game.data.callHistory.some(call => 
        call.text.includes('1点')
      );

      // 分别计算两个玩家的点数统计
      const player1Count = {};
      const player2Count = {};
      
      player1Dice.forEach(dice => {
        player1Count[dice] = (player1Count[dice] || 0) + 1;
      });
      
      player2Dice.forEach(dice => {
        player2Count[dice] = (player2Count[dice] || 0) + 1;
      });

      // 计算实际数量
      let actualCount = 0;

      // 检查玩家一的骰子
      const checkPlayer1Dice = () => {
        // 检查是否所有点数都只出现一次
        let allSingle = true;
        let hasDuplicate = false;
        for (let dice in player1Count) {
          if (player1Count[dice] > 1) {
            allSingle = false;
            hasDuplicate = true;
            break;
          }
        }

        // 如果所有点数都只出现一次，返回0
        if (allSingle) {
          return 0;
        }

        // 检查是否所有点数都相同
        const nonOneCount = Object.entries(player1Count).find(([dice, count]) => 
          dice !== '1' && count > 0
        );

        if (nonOneCount) {
          const [targetValue, targetCount] = nonOneCount;
          const onesCount = player1Count[1] || 0;
          
          // 如果所有骰子都是这个数字（包括1可以当任何数）
          if (targetCount + onesCount === 5) {
            return onesCount > 0 ? 6 : 7; // 有1用6，没1用7
          }
        }

        // 如果不是所有点数都相同，按正常规则计算
        if (!hasCalledOne) {
          return (player1Count[value] || 0) + (player1Count[1] || 0);
        } else {
          return player1Count[value] || 0;
        }
      };

      // 检查玩家二的骰子
      const checkPlayer2Dice = () => {
        // 检查是否所有点数都只出现一次
        let allSingle = true;
        let hasDuplicate = false;
        for (let dice in player2Count) {
          if (player2Count[dice] > 1) {
            allSingle = false;
            hasDuplicate = true;
            break;
          }
        }

        // 如果所有点数都只出现一次，返回0
        if (allSingle) {
          return 0;
        }

        // 检查是否所有点数都相同
        const nonOneCount = Object.entries(player2Count).find(([dice, count]) => 
          dice !== '1' && count > 0
        );

        if (nonOneCount) {
          const [targetValue, targetCount] = nonOneCount;
          const onesCount = player2Count[1] || 0;
          
          // 如果所有骰子都是这个数字（包括1可以当任何数）
          if (targetCount + onesCount === 5) {
            return onesCount > 0 ? 6 : 7; // 有1用6，没1用7
          }
        }

        // 如果不是所有点数都相同，按正常规则计算
        if (!hasCalledOne) {
          return (player2Count[value] || 0) + (player2Count[1] || 0);
        } else {
          return player2Count[value] || 0;
        }
      };

      // 计算最终的实际数量
      actualCount = checkPlayer1Dice() + checkPlayer2Dice();

      // 判断胜负
      let winner;
      if (actualCount >= count) {
        winner = this.data.currentPlayer === 1 ? 2 : 1;
      } else {
        winner = this.data.currentPlayer;
      }

      // 更新游戏状态和胜利次数
      await db.collection('games').doc(this.data.gameId).update({
        data: {
          gameStatus: 'ended',
          showResult: true,
          actualCount: actualCount,
          winner: winner,
          player1Wins: winner === 1 ? db.command.inc(1) : db.command.inc(0),
          player2Wins: winner === 2 ? db.command.inc(1) : db.command.inc(0)
        }
      });

      // 立即从数据库获取最新的胜利次数
      const updatedGame = await db.collection('games').doc(this.data.gameId).get();

      // 更新本地状态
      this.setData({
        showResult: true,
        winner: winner,
        player1Wins: updatedGame.data.player1Wins,
        player2Wins: updatedGame.data.player2Wins,
        player1Dice: updatedGame.data.player1Dice,
        player2Dice: updatedGame.data.player2Dice
      });

      // 显示胜利提示和双方骰子
      wx.showModal({
        title: '游戏结束',
        content: `胜利方为玩家${winner}\n\n玩家一的骰子: ${player1Dice.join(', ')}\n玩家二的骰子: ${player2Dice.join(', ')}`,
        showCancel: false
      });

    } catch (error) {
      console.error('质疑失败：', error);
    } finally {
      // 延迟解锁按钮，防止快速连击
      setTimeout(() => {
        this.setData({ isButtonLocked: false });
      }, 1000); // 1秒后解锁
    }
  },

  // 修改重新开始方法
  async restart() {
    try {
      // 获取当前游戏数据
      const game = await db.collection('games').doc(this.data.gameId).get();
      const lastWinner = game.data.winner;
      
      // 确定下一局的先手玩家
      const nextFirstPlayer = lastWinner === 1 ? 2 : 1;

      await db.collection('games').doc(this.data.gameId).update({
        data: {
          player1Dice: [],
          player2Dice: [],
          currentPlayer: nextFirstPlayer,  // 设置为上一局的失败者
          lastCall: {
            count: 0,
            value: 0
          },
          gameStatus: 'ready',
          showResult: false,
          actualCount: 0,
          callHistory: []  // 清空历史记录
        }
      });

      // 本地也清空历史记录和状态
      this.setData({
        callHistory: [],
        showResult: false, // 重置显示状态
        lastCall: {  // 重置最后叫数
          count: 0,
          value: 0
        }
      });

      wx.showToast({
        title: '游戏已重新开始',
        icon: 'success',
        duration: 1500
      });
    } catch (error) {
      console.error('重新开始失败：', error);
      wx.showToast({
        title: '重新开始失败',
        icon: 'none'
      });
    }
  },

  // 添加重连方法
  tryReconnect() {
    if (this.data.reconnectCount >= this.data.maxReconnectCount) {
      wx.showModal({
        title: '连接失败',
        content: '是否重新进入游戏？',
        success: (res) => {
          if (res.confirm) {
            // 重新初始化游戏
            this.initGame()
          } else {
            wx.navigateBack({
              delta: 1
            })
          }
        }
      })
      return
    }

    this.setData({
      reconnectCount: this.data.reconnectCount + 1,
      waitingText: `正在重新连接...(${this.data.reconnectCount + 1}/${this.data.maxReconnectCount})`
    })

    setTimeout(() => {
      console.log(`第${this.data.reconnectCount}次重试连接...`)
      this.watchGameChanges()
    }, 1000 * Math.min(this.data.reconnectCount, 5))
  },

  // 添加计算按钮是否禁用的方法
  isButtonDisabled() {
    const isMyTurn = (this.data.isPlayer1 && this.data.currentPlayer === 1) || 
                     (!this.data.isPlayer1 && this.data.currentPlayer === 2);
    return this.data.gameStatus !== 'ready' || !isMyTurn;
  },

  // 添加"加一"方法
  async addOne() {
    // 如果按钮已锁定，直接返回
    if (this.data.isButtonLocked) {
      return;
    }

    if (this.data.currentPlayer !== (this.data.isPlayer1 ? 1 : 2)) {
      wx.showToast({
        title: '还没轮到你',
        icon: 'none'
      });
      return;
    }

    const lastCall = this.data.lastCall;
    if (!lastCall.count) {
      wx.showToast({
        title: '还没有人叫数',
        icon: 'none'
      });
      return;
    }

    // 锁定按钮
    this.setData({ isButtonLocked: true });

    try {
      // 先获取当前游戏数据
      const game = await db.collection('games').doc(this.data.gameId).get();
      const currentHistory = game.data.callHistory || [];
      const playerText = this.data.isPlayer1 ? '玩家一' : '玩家二';
      const newCount = lastCall.count + 1;
      const callText = `${this.data.numberWords[newCount-1]}个${lastCall.value}点`;
      
      // 构建新的历史记录
      const newHistory = [...currentHistory];
      if (this.data.isPlayer1) {
        newHistory.push({ player: 1, text: callText });
      } else {
        newHistory.push({ player: 2, text: callText });
      }

      // 更新数据库
      await db.collection('games').doc(this.data.gameId).update({
        data: {
          lastCall: {
            count: newCount,
            value: lastCall.value
          },
          currentPlayer: this.data.currentPlayer === 1 ? 2 : 1,
          gameStatus: 'playing',
          callHistory: newHistory
        }
      });

    } catch (error) {
      console.error('加一失败：', error);
      wx.showToast({
        title: '加一失败，请重试',
        icon: 'none'
      });
    } finally {
      // 延迟解锁按钮，防止快速连击
      setTimeout(() => {
        this.setData({ isButtonLocked: false });
      }, 1000); // 1秒后解锁
    }
  },
})
