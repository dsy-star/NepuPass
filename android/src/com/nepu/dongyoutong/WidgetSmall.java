package com.nepu.dongyoutong;

/**
 * 2×2 方形小组件（0.52.0 v12 加）。
 *
 * 这个类里**一行代码都没有**，它存在的唯一理由是：系统按 receiver 认小组件，
 * 一个类只能挂一个 receiver。画法在 {@link WidgetProvider#kindOf} 里按类分派，
 * 尺寸和预览在 `res/xml/hyt_widget_info_small.xml` 里，布局是
 * `res/layout/hyt_widget_small.xml`。
 *
 * 🔴 别把它改成 `extends AppWidgetProvider` 再复制一份画法：
 *    四个尺寸四份画法，改一处漏三处。
 */
public class WidgetSmall extends WidgetProvider {
}
