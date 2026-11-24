package com.nepu.dongyoutong;

/**
 * 4×4 大方块小组件（0.52.0 v12 加）。
 *
 * 空类，理由同 {@link WidgetSmall}：系统按 receiver 认小组件，一个类只能挂一个。
 *
 * 🔴 它和 4×2 用**同一份布局、同一套画法**（{@link WidgetProvider#KIND_FULL}）：
 *    差别只在 res/xml 里那一行高度 —— 卡片高，fitRows 算出来的行数就多
 *    （4×4 是 6 行，4×2 是 2 行）。所以这里不需要任何代码。
 */
public class WidgetLarge extends WidgetProvider {
}
