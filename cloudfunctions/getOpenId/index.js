// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: 'duoduowu-9g5xj9o59b6811b5'
})

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  return {
    event,
    openid: wxContext.OPENID,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID,
  }
} 