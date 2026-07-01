export default defineNuxtPlugin(() => {
  // 强制注入绿色主题 CSS，优先级最高
  const style = document.createElement('style')
  style.id = 'theme-override'
  style.textContent = `
    :root {
      --el-color-primary: #1da14dff !important;
      --el-color-primary-light-3: #42c672ff !important;
      --el-color-primary-light-5: #78d49aff !important;
      --el-color-primary-light-7: #9acdacff !important;
      --el-color-primary-light-8: #c8e4d2ff !important;
      --el-color-primary-light-9: #f0fdf4 !important;
      --el-color-primary-dark-2: #12853dff !important;
    }

    /* 强制覆盖按钮 */
    .el-button--primary {
      background-color: var(--el-color-primary) !important;
      border-color: var(--el-color-primary) !important;
    }
    .el-button--primary:hover {
      background-color: var(--el-color-primary-light-3) !important;
      border-color: var(--el-color-primary-light-3) !important;
    }
    .el-button--primary:active {
      background-color: var(--el-color-primary-dark-2) !important;
      border-color: var(--el-color-primary-dark-2) !important;
    }

    /* 强制覆盖复选框 */
    .el-checkbox__input.is-checked .el-checkbox__inner {
      background-color: var(--el-color-primary) !important;
      border-color: var(--el-color-primary) !important;
    }

    /* 强制覆盖单选框 */
    .el-radio__input.is-checked .el-radio__inner {
      border-color: var(--el-color-primary) !important;
      background-color: var(--el-color-primary) !important;
    }
    .el-radio__input.is-checked+.el-radio__label {
      color: var(--el-color-primary) !important;
    }

    /* 强制覆盖开关 */
    .el-switch.is-checked .el-switch__core {
      background-color: var(--el-color-primary) !important;
      border-color: var(--el-color-primary) !important;
    }

    /* 强制覆盖分页 */
    .el-pager li.is-active {
      color: white !important;
      background-color: var(--el-color-primary) !important;
    }

    /* 强制覆盖输入框 */
    .el-input .el-input__wrapper.is-focus,
    .el-input .el-input__wrapper:hover {
      box-shadow: 0 0 0 1px var(--el-color-primary) inset !important;
    }

    /* 强制覆盖标签页 */
    .el-tabs__item.is-active {
      color: var(--el-color-primary) !important;
    }
    .el-tabs__active-bar {
      background-color: var(--el-color-primary) !important;
    }

    /* 强制覆盖链接 */
    .el-link--primary {
      color: var(--el-color-primary) !important;
    }

    /* 强制覆盖标签 */
    .el-tag--primary {
      background-color: var(--el-color-primary-light-9) !important;
      border-color: var(--el-color-primary-light-8) !important;
      color: var(--el-color-primary) !important;
    }
    .el-tag--primary.is-dark {
      background-color: var(--el-color-primary) !important;
      border-color: var(--el-color-primary) !important;
    }
  `
  document.head.prepend(style)
})
