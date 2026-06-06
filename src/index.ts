import { Context, Schema, Logger, Session, sleep } from 'koishi'
import {} from 'koishi-plugin-adapter-onebot'

const logger = new Logger('gcard-keeper')

export const usage = `
<div style="border-radius: 10px; border: 1px solid #ddd; padding: 16px; margin-bottom: 20px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
  <h2 style="margin-top: 0; color: #4a6ee0;">📌 插件说明</h2>
  <p>📖 <strong>使用文档</strong>：请点击左上角的 <strong>插件主页</strong> 查看插件使用文档</p>
  <p>🔍 <strong>更多插件</strong>：可访问 <a href="https://github.com/YisRime" style="color:#4a6ee0;text-decoration:none;">苡淞的 GitHub</a> 查看本人的所有插件</p>
</div>

<div style="border-radius: 10px; border: 1px solid #ddd; padding: 16px; margin-bottom: 20px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
  <h2 style="margin-top: 0; color: #e0574a;">❤️ 支持与反馈</h2>
  <p>🌟 喜欢这个插件？请在 <a href="https://github.com/YisRime" style="color:#e0574a;text-decoration:none;">GitHub</a> 上给我一个 Star！</p>
  <p>🐛 遇到问题？请通过 <strong>Issues</strong> 提交反馈，或加入 QQ 群 <a href="https://qm.qq.com/q/PdLMx9Jowq" style="color:#e0574a;text-decoration:none;"><strong>855571375</strong></a> 进行交流</p>
</div>
`

export interface Config {
  botNickname: string
  revertOnReady: boolean
  revertOnUpdate: boolean
  revertForbidden: boolean
  revertExcludeGuilds?: string[]
  forbiddenKeywords?: Record<string, string>
  notification: false | true | string
  notificationMessage: string
}

export const Config: Schema<Config> = Schema.object({
  notification: Schema.union([
    Schema.const(false).description('关闭'),
    Schema.const(true).description('开启 (原群)'),
    Schema.string().description('开启 (指定)'),
  ]).description('名片变更通知').default(false),
  notificationMessage: Schema.string()
    .description('通知消息模板')
    .default('群:{guildName}({guildId})\n用户:{userName}({userId})\n名片:{newCard}({oldCard})'),
  botNickname: Schema.string().description('机器人群名片'),
  revertOnReady: Schema.boolean().description('初始化时恢复').default(false),
  revertOnUpdate: Schema.boolean().description('被修改时恢复').default(false),
  revertForbidden: Schema.boolean().description('恢复违规名片').default(false),
  revertExcludeGuilds: Schema.array(String).description('自身排除列表').role('table'),
  forbiddenKeywords: Schema.dict(Schema.string()).role('table').description('违规名片配置'),
})

export function apply(ctx: Context, config: Config) {
  if (config.revertOnReady && config.botNickname) {
    ctx.on('ready', async () => {
      sleep(5000)
      for (const bot of ctx.bots.filter(b => b.platform === 'onebot')) {
        try {
          const list = await (bot as any).internal?.getGroupList?.() || []
          const ids = list.map((g: any) => g.group_id?.toString()).filter(Boolean)
          logger.debug(`机器人 ${bot.selfId} 所在群列表: ${ids.join(', ')}`)
          for (const gid of ids) {
            if (config.revertExcludeGuilds?.includes(gid)) continue
            sleep(5000)
            await (bot as any).internal?.setGroupCard?.(gid, bot.selfId, config.botNickname)
              .then(() => logger.debug(`已设置群 ${gid} 中 ${bot.selfId} 的名片`))
              .catch((e: any) => logger.error(`设置群 ${gid} 中 ${bot.selfId} 的名片失败:`, e))
          }
        } catch (e) {
          logger.error(`初始化 ${bot.selfId} 群名片失败:`, e)
        }
      }
    })
  }

  const needListener = config.revertOnUpdate || config.revertForbidden || config.notification !== false
  if (needListener) {
    ctx.on('guild-member' as any, async (session: Session) => {
      const data = (session.event as any)?._data
      if (session.platform !== 'onebot' || data?.notice_type !== 'group_card') return
      const { card_old: oldCard = '', card_new: newCard = '', user_id } = data
      const { guildId, selfId, bot } = session
      const targetUserId = String(user_id || '')
      if (!guildId || !targetUserId || oldCard === newCard) return
      let isReverted = false
      const isBot = targetUserId === selfId
      if (isBot && config.revertOnUpdate && config.botNickname && newCard !== config.botNickname) {
        if (!config.revertExcludeGuilds?.includes(guildId)) {
          await (bot as any).internal?.setGroupCard?.(guildId, selfId, config.botNickname)
          logger.info(`已恢复群 ${guildId} 中 ${selfId} 的名片`)
          isReverted = true
        }
      }
      const regex = config.forbiddenKeywords?.[guildId]
      if (!isReverted && config.revertForbidden && regex && new RegExp(regex).test(newCard)) {
        const info = await (bot as any).internal.getGroupMemberInfo?.(guildId, selfId, true)
        if (['admin', 'owner'].includes(info?.role)) await (bot as any).internal?.setGroupCard?.(guildId, targetUserId, oldCard)
      }
      let target = config.notification === true ? guildId : (typeof config.notification === 'string' ? config.notification : null)
      if (target?.includes(':')) {
        const [type, id] = target.split(':')
        target = (id && (type === 'guild' || type === 'private')) ? (type === 'guild' ? id : target) : guildId
      }
      if (target && config.notificationMessage) {
        const [u, g] = await Promise.all([bot.getUser(targetUserId), bot.getGuild(guildId)])
        const msg = config.notificationMessage.replace(/\{(userName|userId|guildName|guildId|oldCard|newCard)\}/g, (m) => {
          return {
            '{userName}': u?.name || targetUserId, '{userId}': targetUserId, '{guildName}': g?.name || guildId,
            '{guildId}': guildId, '{oldCard}': oldCard || '无', '{newCard}': newCard || '无'
          }[m] || m
        })
        if (msg.trim()) await bot.sendMessage(target, msg)
      }
    })
  }
}
