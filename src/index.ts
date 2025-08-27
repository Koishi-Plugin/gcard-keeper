import { Context, Schema, Logger } from 'koishi'
import {} from 'koishi-plugin-adapter-onebot'

export const name = 'gcard-keeper'

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
  botNickname: false | string
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
    Schema.string().description('开启 (指定目标)'),
  ]).description('群名片变更通知').default(false),
  notificationMessage: Schema.string()
    .description('通知消息模板')
    .default('{guildName}({guildId}) 中 {userName}({userId}) 的名片由 {oldCard} 更新为 {newCard}'),
  botNickname: Schema.union([
    Schema.const(false).description('关闭'),
    Schema.string().description('开启'),
  ]).description('自动恢复自身群名片').default(false),
  revertForbidden: Schema.boolean()
    .description('自动恢复违规群名片').default(false),
  revertExcludeGuilds: Schema.array(String)
    .description('排除群组列表').role('table'),
  forbiddenKeywords: Schema.dict(Schema.string()).role('table')
    .description('违规群名片配置 (群号:正则)'),
})

/**
 * 插件主函数
 * @param ctx Koishi 上下文
 * @param config 插件配置
 */
export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger(name)

  ctx.on('guild-member' as any, async (session) => {
    if (session.platform !== 'onebot' || session.event._data?.notice_type !== 'group_card') return

    const { card_old: oldCard, card_new: newCard, user_id: rawUserId } = session.event._data
    const targetUserId = String(rawUserId)
    if (oldCard === newCard) return

    await handleRevert(session, config, logger, targetUserId, newCard, oldCard)
    await handleNotify(session, logger, config, oldCard, newCard)
  })
}

/**
 * 处理所有恢复逻辑
 * @param session Koishi 会话对象
 * @param config 插件配置
 * @param logger 日志记录器
 * @param targetUserId 目标用户ID
 * @param newCard 新名片
 * @param oldCard 旧名片
 */
async function handleRevert(session: any, config: Config, logger: Logger, targetUserId: string, newCard: string, oldCard: string) {
  const { guildId, selfId } = session;

  if (config.revertExcludeGuilds?.includes(guildId)) return;
  if (typeof config.botNickname === 'string' && targetUserId === selfId && newCard !== config.botNickname) {
    await session.onebot.setGroupCard(guildId, selfId, config.botNickname);
    return;
  }

  const forbiddenRegexStr = config.forbiddenKeywords?.[guildId];
  if (config.revertForbidden && forbiddenRegexStr) {
    try {
      if (new RegExp(forbiddenRegexStr).test(newCard)) {
        const botInfo = await session.onebot.getGroupMemberInfo(+guildId, +selfId, true);
        const isAdmin = botInfo?.role === 'owner' || botInfo?.role === 'admin';
        if (isAdmin) await session.onebot.setGroupCard(guildId, targetUserId, oldCard);
      }
    } catch (error) {
      logger.warn(`恢复名片(${guildId}:${targetUserId})出错:`, error);
    }
  }
}

/**
 * 处理发送通知逻辑
 * @param session Koishi 会话对象
 * @param logger 日志记录器
 * @param config 插件配置
 * @param oldCard 旧名片
 * @param newCard 新名片
 */
async function handleNotify(session: any, logger: Logger, config: Config, oldCard: string, newCard: string) {
  const targetChannelId = getNotificationTarget(config, session.guildId, logger)
  if (!targetChannelId || !config.notificationMessage) return

  const { bot } = session
  const targetUserId = session.event._data.user_id.toString()

  try {
    const [user, guild] = await Promise.all([
      bot.getUser(targetUserId).catch(() => null),
      bot.getGuild(session.guildId).catch(() => null),
    ])

    const replacements = {
      '{userName}': user?.name || targetUserId,
      '{userId}': targetUserId,
      '{guildName}': guild?.name || session.guildId,
      '{guildId}': session.guildId,
      '{oldCard}': oldCard || '无',
      '{newCard}': newCard || '无',
    }

    const message = config.notificationMessage.replace(
      /\{userName\}|\{userId\}|\{guildName\}|\{guildId\}|\{oldCard\}|\{newCard\}/g,
      (match) => replacements[match]
    )

    if (message.trim()) await bot.sendMessage(targetChannelId, message)
  } catch (error) {
    logger.error(`发送群名片变动通知至 ${targetChannelId} 失败:`, error)
  }
}

/**
 * 根据配置确定发送通知的目标频道ID
 * @param config 插件配置
 * @param guildId 事件发生的群组ID
 * @param logger 日志记录器
 * @returns 目标频道ID，如果无需发送则返回 null
 */
function getNotificationTarget(config: Config, guildId: string, logger: Logger): string | null {
  if (config.notification === false) return null
  if (config.notification === true) return guildId

  if (typeof config.notification === 'string') {
    const [targetType, targetId] = config.notification.split(':')
    if (targetId && (targetType === 'guild' || targetType === 'private')) return targetType === 'guild' ? targetId : `private:${targetId}`
    logger.warn(`通知目标格式错误: ${config.notification}`)
    return guildId
  }

  return null
}
