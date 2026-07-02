import path from 'path'
import fs from 'fs'
import { preprocessImage, ensureDir, saveFile } from './image'
import { ocrStep } from './ocr'
import { visionStep } from './vision'
import { postprocessStep } from './postprocess'

export interface RecognitionOptions {
  outputDir?: string
  tileEnabled?: boolean
  twoPassEnabled?: boolean
  ocrEngine?: string
}

const testData={
    "result": {
        "drawing_info": {
            "title": "客厅衣柜/设备柜/宠物柜",
            "scale": "未标注",
            "type": "立面图",
            "date": "未标注"
        },
        "elements": [
            {
                "id": 1,
                "type": "板",
                "description": "顶封板或顶部间隙",
                "position": "最上方",
                "properties": {
                    "width": "柜体总宽",
                    "height": "36",
                    "material": "板材",
                    "thickness": "36"
                },
                "confidence": "high",
                "_tile": 0
            },
            {
                "id": 2,
                "type": "板",
                "description": "第一层横向层板",
                "position": "顶部下方500mm处",
                "properties": {
                    "width": "柜体总宽",
                    "height": "18",
                    "material": "板材",
                    "thickness": "18"
                },
                "confidence": "high",
                "_tile": 0
            },
            {
                "id": 3,
                "type": "板",
                "description": "第二层横向层板（挂衣区下方）",
                "position": "915mm高度处下方",
                "properties": {
                    "width": "柜体总宽",
                    "height": "18",
                    "material": "板材",
                    "thickness": "18"
                },
                "confidence": "high",
                "_tile": 0
            },
            {
                "id": 4,
                "type": "板",
                "description": "第三层横向层板",
                "position": "415mm高度处下方",
                "properties": {
                    "width": "柜体总宽",
                    "height": "18",
                    "material": "板材",
                    "thickness": "18"
                },
                "confidence": "high",
                "_tile": 0
            },
            {
                "id": 5,
                "type": "板",
                "description": "底封板或踢脚线",
                "position": "最下方",
                "properties": {
                    "width": "柜体总宽",
                    "height": "18",
                    "material": "板材",
                    "thickness": "18"
                },
                "confidence": "high",
                "_tile": 0
            },
            {
                "id": 6,
                "type": "空间/柜体",
                "description": "左侧列柜体，包含手工材料、次净衣、包包、工具箱等分区",
                "position": "左侧",
                "properties": {
                    "width": "约400-500mm",
                    "height": "约2200mm",
                    "material": "木质",
                    "thickness": "18"
                },
                "confidence": "high",
                "_tile": 0
            },
            {
                "id": 7,
                "type": "空间/柜体",
                "description": "中间列柜体，包含被褥、挂衣区（长短袖、外套等）、叠放区（裤、家居服等）",
                "position": "中间",
                "properties": {
                    "width": "约800-1000mm",
                    "height": "约2200mm",
                    "material": "木质",
                    "thickness": "18"
                },
                "confidence": "high",
                "_tile": 0
            },
            {
                "id": 8,
                "type": "空间/柜体",
                "description": "右侧列柜体，包含文件、电子产品、模型、常用物品、手工材料箱",
                "position": "右侧",
                "properties": {
                    "width": "约600-800mm",
                    "height": "约2200mm",
                    "material": "木质",
                    "thickness": "18"
                },
                "confidence": "high",
                "_tile": 0
            },
            {
                "id": 1,
                "type": "板",
                "description": "垂直侧板，分隔左侧储物区与中间主衣柜区",
                "position": "左侧偏中",
                "properties": {
                    "width": "18mm",
                    "height": "2400mm",
                    "material": "实木颗粒板/多层板",
                    "thickness": "18mm"
                },
                "confidence": "high",
                "_tile": 1
            },
            {
                "id": 2,
                "type": "板",
                "description": "垂直侧板，分隔中间主衣柜区与右侧窄条储物区",
                "position": "中间偏右",
                "properties": {
                    "width": "18mm",
                    "height": "2400mm",
                    "material": "实木颗粒板/多层板",
                    "thickness": "18mm"
                },
                "confidence": "high",
                "_tile": 1
            },
            {
                "id": 3,
                "type": "板",
                "description": "垂直侧板，分隔右侧窄条储物区与右侧宽储物区",
                "position": "右侧",
                "properties": {
                    "width": "18mm",
                    "height": "2400mm",
                    "material": "实木颗粒板/多层板",
                    "thickness": "18mm"
                },
                "confidence": "high",
                "_tile": 1
            },
            {
                "id": 4,
                "type": "板",
                "description": "水平隔板，位于中间主衣柜区上部，分隔叠放区与挂衣区",
                "position": "中上",
                "properties": {
                    "width": "800mm",
                    "height": "18mm",
                    "material": "实木颗粒板/多层板",
                    "thickness": "18mm"
                },
                "confidence": "high",
                "_tile": 1
            },
            {
                "id": 5,
                "type": "其他配饰",
                "description": "挂衣杆，位于中间主衣柜区中部",
                "position": "中左",
                "properties": {
                    "width": "800mm",
                    "height": "25mm",
                    "material": "金属",
                    "thickness": "25mm"
                },
                "confidence": "high",
                "_tile": 1
            },
            {
                "id": 6,
                "type": "板",
                "description": "水平隔板，位于右侧宽储物区上部，分隔小格子与大空间",
                "position": "右上",
                "properties": {
                    "width": "600mm",
                    "height": "18mm",
                    "material": "实木颗粒板/多层板",
                    "thickness": "18mm"
                },
                "confidence": "high",
                "_tile": 1
            }
        ],
        "spaces": [
            {
                "name": "顶部储物区",
                "estimated_area": "柜体总宽 x 500mm",
                "connections": [
                    "手工材料包区",
                    "被褥区",
                    "文件/电子产品区"
                ],
                "position": "柜体最上层"
            },
            {
                "name": "中部主要储物区",
                "estimated_area": "柜体总宽 x 915mm",
                "connections": [
                    "次净衣区",
                    "挂衣区",
                    "模型/数码区"
                ],
                "position": "柜体中上部"
            },
            {
                "name": "下部储物区",
                "estimated_area": "柜体总宽 x 415mm",
                "connections": [
                    "袋子/球拍包区",
                    "叠放衣物区",
                    "常用物品区"
                ],
                "position": "柜体中下部"
            },
            {
                "name": "底部储物区",
                "estimated_area": "柜体总宽 x 300mm",
                "connections": [
                    "工具箱",
                    "小金猪",
                    "手工材料箱"
                ],
                "position": "柜体最下层"
            },
            {
                "name": "左侧电子/杂物区",
                "estimated_area": "0.5平方米",
                "connections": [
                    "中间主衣柜区"
                ],
                "position": "最左侧（部分可见）"
            },
            {
                "name": "中间主衣柜区",
                "estimated_area": "2.5平方米",
                "connections": [
                    "左侧电子/杂物区",
                    "右侧宠物/杂物窄条区"
                ],
                "position": "中间"
            },
            {
                "name": "右侧宠物/杂物窄条区",
                "estimated_area": "0.8平方米",
                "connections": [
                    "中间主衣柜区",
                    "右侧宽储物区"
                ],
                "position": "中间偏右"
            },
            {
                "name": "右侧宠物用品区",
                "estimated_area": "1.2平方米",
                "connections": [
                    "右侧宠物/杂物窄条区"
                ],
                "position": "右侧"
            }
        ],
        "dimensions": [
            {
                "value": "36",
                "target": "顶部间隙或顶板厚度",
                "position": "左侧最上方"
            },
            {
                "value": "500",
                "target": "第一层储物格高度",
                "position": "左侧上部"
            },
            {
                "value": "18",
                "target": "层板厚度",
                "position": "左侧尺寸标注链中"
            },
            {
                "value": "915",
                "target": "第二层储物格（挂衣/次净衣）高度",
                "position": "左侧中部"
            },
            {
                "value": "415",
                "target": "第三层储物格（叠放/袋子）高度",
                "position": "左侧下部"
            },
            {
                "value": "300",
                "target": "底部储物格高度",
                "position": "左侧最下方"
            }
        ],
        "annotations": [
            {
                "text": "客厅衣柜/设备柜/宠物柜",
                "type": "title",
                "position": "顶部居中"
            },
            {
                "text": "手工材料包",
                "type": "label",
                "position": "左上格"
            },
            {
                "text": "手工工具",
                "type": "label",
                "position": "左上格虚线框内"
            },
            {
                "text": "次净衣区",
                "type": "label",
                "position": "左中格上部"
            },
            {
                "text": "包包",
                "type": "label",
                "position": "左中格下部"
            },
            {
                "text": "袋子",
                "type": "label",
                "position": "左下格虚线框内"
            },
            {
                "text": "球拍包",
                "type": "label",
                "position": "左下格虚线框内"
            },
            {
                "text": "工具箱",
                "type": "label",
                "position": "左底格"
            },
            {
                "text": "被子",
                "type": "label",
                "position": "中上格左侧"
            },
            {
                "text": "枕头",
                "type": "label",
                "position": "中上格左侧"
            },
            {
                "text": "沙发替换罩子",
                "type": "label",
                "position": "中上格右侧"
            },
            {
                "text": "吊带内衣内裤",
                "type": "label",
                "position": "中中格挂衣区最左"
            },
            {
                "text": "短袖T恤",
                "type": "label",
                "position": "中中格挂衣区"
            },
            {
                "text": "短袖衬衫",
                "type": "label",
                "position": "中中格挂衣区"
            },
            {
                "text": "长袖T恤",
                "type": "label",
                "position": "中中格挂衣区"
            },
            {
                "text": "长袖衬衫",
                "type": "label",
                "position": "中中格挂衣区"
            },
            {
                "text": "春秋外套",
                "type": "label",
                "position": "中中格挂衣区"
            },
            {
                "text": "卫衣",
                "type": "label",
                "position": "中中格挂衣区最右"
            },
            {
                "text": "短裤短裙",
                "type": "label",
                "position": "中下格叠放区最左"
            },
            {
                "text": "薄家居服",
                "type": "label",
                "position": "中下格叠放区"
            },
            {
                "text": "运动服",
                "type": "label",
                "position": "中下格叠放区"
            },
            {
                "text": "长裤",
                "type": "label",
                "position": "中下格叠放区最右"
            },
            {
                "text": "小金猪",
                "type": "label",
                "position": "中底格"
            },
            {
                "text": "重要文件",
                "type": "label",
                "position": "右上格左侧"
            },
            {
                "text": "按摩仪",
                "type": "label",
                "position": "右上格左侧"
            },
            {
                "text": "证书/纪念品",
                "type": "label",
                "position": "右上格右侧虚线框"
            },
            {
                "text": "电子产品",
                "type": "label",
                "position": "右上格右侧虚线框"
            },
            {
                "text": "手工模型",
                "type": "label",
                "position": "右中上格"
            },
            {
                "text": "乐高",
                "type": "label",
                "position": "右中上格"
            },
            {
                "text": "VR眼镜",
                "type": "label",
                "position": "右中上格"
            },
            {
                "text": "相机",
                "type": "label",
                "position": "右中上格"
            },
            {
                "text": "笔记本电脑",
                "type": "label",
                "position": "右中上格"
            },
            {
                "text": "常用物品",
                "type": "label",
                "position": "右中格虚线框内"
            },
            {
                "text": "手工材料箱",
                "type": "label",
                "position": "右底格虚线框"
            },
            {
                "text": "(有颜料)",
                "type": "note",
                "position": "右底格虚线框内"
            },
            {
                "text": "书/纪念品",
                "type": "label",
                "position": "左上"
            },
            {
                "text": "电子产品",
                "type": "label",
                "position": "左上"
            },
            {
                "text": "相机",
                "type": "label",
                "position": "左侧"
            },
            {
                "text": "笔记本电脑",
                "type": "label",
                "position": "左侧"
            },
            {
                "text": "常用物品",
                "type": "label",
                "position": "左侧"
            },
            {
                "text": "厚家居服",
                "type": "label",
                "position": "中上"
            },
            {
                "text": "毛衣",
                "type": "label",
                "position": "中上"
            },
            {
                "text": "连衣裙",
                "type": "label",
                "position": "中左"
            },
            {
                "text": "冬季厚外套",
                "type": "label",
                "position": "中"
            },
            {
                "text": "厚家居服",
                "type": "label",
                "position": "中下"
            },
            {
                "text": "袜子",
                "type": "label",
                "position": "中下"
            },
            {
                "text": "浴巾",
                "type": "label",
                "position": "中下"
            },
            {
                "text": "钱包",
                "type": "label",
                "position": "中下"
            },
            {
                "text": "围巾/帽子/配饰",
                "type": "label",
                "position": "中下"
            },
            {
                "text": "五金小工具",
                "type": "label",
                "position": "中右列上"
            },
            {
                "text": "狗狗衣服牵引绳",
                "type": "label",
                "position": "中右列中上"
            },
            {
                "text": "宠物零食",
                "type": "label",
                "position": "中右列中"
            },
            {
                "text": "宠物毯子小屋",
                "type": "label",
                "position": "中右列中下"
            },
            {
                "text": "猫砂猫包",
                "type": "label",
                "position": "中右列下"
            },
            {
                "text": "宠物尿片",
                "type": "label",
                "position": "右列上左"
            },
            {
                "text": "清洁用品",
                "type": "label",
                "position": "右列上中"
            },
            {
                "text": "宠物碗",
                "type": "label",
                "position": "右列上右"
            },
            {
                "text": "侧板按图开缺",
                "type": "note",
                "position": "右下"
            }
        ],
        "ocr_verified": [
            "客厅",
            "衣柜",
            "/设备",
            "柜",
            "/",
            "宠",
            "物",
            "材",
            "重要",
            "文件",
            "证",
            "书",
            "/纪念",
            "品",
            "被",
            "子",
            "沙发",
            "证书/",
            "纪念品",
            "外",
            "包",
            "枕头",
            "换",
            "按摩",
            "仪",
            "电子",
            "工",
            "手工",
            "模型",
            "工具",
            "乐",
            "VR",
            "相机",
            "内",
            "衣",
            "袖",
            "机",
            "次",
            "净",
            "短",
            "长",
            "家",
            "动",
            "球拍",
            "居",
            "服",
            "材料",
            "箱",
            "零食",
            "毯子",
            "一",
            "|"
        ],
        "ocr_unverified": [
            "#|",
            "，",
            "件",
            "四",
            ".相机",
            "恤衫",
            "=",
            "&",
            "一",
            "E",
            "ol",
            "B",
            ":",
            "证",
            "证书/",
            "到",
            ";",
            "-+",
            "!",
            "<",
            "手",
            "有",
            "INR",
            "[一",
            "-一"
        ],
        "summary": "这是一张客厅多功能组合柜的立面设计图，详细规划了左侧手工与次净衣收纳、中间衣物悬挂与叠放、右侧文件设备与杂物储存的分区及尺寸。 | 这是一张衣柜内部立面设计图，详细规划了衣物（外套、毛衣等）、电子产品、杂物以及大量宠物用品（猫砂、狗粮、宠物毯等）的收纳空间，并在右下角标注了侧板开缺的施工要求。"
    },
    "usage": {
        "total_tokens": 14917
    },
    "rawText": "{\"drawing_info\":{\"title\":\"客厅衣柜/设备柜/宠物柜\",\"scale\":\"未标注\",\"type\":\"立面图\",\"date\":\"未标注\"},\"elements\":[{\"id\":1,\"type\":\"板\",\"description\":\"顶封板或顶部间隙\",\"position\":\"最上方\",\"properties\":{\"width\":\"柜体总宽\",\"height\":\"36\",\"material\":\"板材\",\"thickness\":\"36\"},\"confidence\":\"high\",\"_tile\":0},{\"id\":2,\"type\":\"板\",\"description\":\"第一层横向层板\",\"position\":\"顶部下方500mm处\",\"properties\":{\"width\":\"柜体总宽\",\"height\":\"18\",\"material\":\"板材\",\"thickness\":\"18\"},\"confidence\":\"high\",\"_tile\":0},{\"id\":3,\"type\":\"板\",\"description\":\"第二层横向层板（挂衣区下方）\",\"position\":\"915mm高度处下方\",\"properties\":{\"width\":\"柜体总宽\",\"height\":\"18\",\"material\":\"板材\",\"thickness\":\"18\"},\"confidence\":\"high\",\"_tile\":0},{\"id\":4,\"type\":\"板\",\"description\":\"第三层横向层板\",\"position\":\"415mm高度处下方\",\"properties\":{\"width\":\"柜体总宽\",\"height\":\"18\",\"material\":\"板材\",\"thickness\":\"18\"},\"confidence\":\"high\",\"_tile\":0},{\"id\":5,\"type\":\"板\",\"description\":\"底封板或踢脚线\",\"position\":\"最下方\",\"properties\":{\"width\":\"柜体总宽\",\"height\":\"18\",\"material\":\"板材\",\"thickness\":\"18\"},\"confidence\":\"high\",\"_tile\":0},{\"id\":6,\"type\":\"空间/柜体\",\"description\":\"左侧列柜体，包含手工材料、次净衣、包包、工具箱等分区\",\"position\":\"左侧\",\"properties\":{\"width\":\"约400-500mm\",\"height\":\"约2200mm\",\"material\":\"木质\",\"thickness\":\"18\"},\"confidence\":\"high\",\"_tile\":0},{\"id\":7,\"type\":\"空间/柜体\",\"description\":\"中间列柜体，包含被褥、挂衣区（长短袖、外套等）、叠放区（裤、家居服等）\",\"position\":\"中间\",\"properties\":{\"width\":\"约800-1000mm\",\"height\":\"约2200mm\",\"material\":\"木质\",\"thickness\":\"18\"},\"confidence\":\"high\",\"_tile\":0},{\"id\":8,\"type\":\"空间/柜体\",\"description\":\"右侧列柜体，包含文件、电子产品、模型、常用物品、手工材料箱\",\"position\":\"右侧\",\"properties\":{\"width\":\"约600-800mm\",\"height\":\"约2200mm\",\"material\":\"木质\",\"thickness\":\"18\"},\"confidence\":\"high\",\"_tile\":0},{\"id\":1,\"type\":\"板\",\"description\":\"垂直侧板，分隔左侧储物区与中间主衣柜区\",\"position\":\"左侧偏中\",\"properties\":{\"width\":\"18mm\",\"height\":\"2400mm\",\"material\":\"实木颗粒板/多层板\",\"thickness\":\"18mm\"},\"confidence\":\"high\",\"_tile\":1},{\"id\":2,\"type\":\"板\",\"description\":\"垂直侧板，分隔中间主衣柜区与右侧窄条储物区\",\"position\":\"中间偏右\",\"properties\":{\"width\":\"18mm\",\"height\":\"2400mm\",\"material\":\"实木颗粒板/多层板\",\"thickness\":\"18mm\"},\"confidence\":\"high\",\"_tile\":1},{\"id\":3,\"type\":\"板\",\"description\":\"垂直侧板，分隔右侧窄条储物区与右侧宽储物区\",\"position\":\"右侧\",\"properties\":{\"width\":\"18mm\",\"height\":\"2400mm\",\"material\":\"实木颗粒板/多层板\",\"thickness\":\"18mm\"},\"confidence\":\"high\",\"_tile\":1},{\"id\":4,\"type\":\"板\",\"description\":\"水平隔板，位于中间主衣柜区上部，分隔叠放区与挂衣区\",\"position\":\"中上\",\"properties\":{\"width\":\"800mm\",\"height\":\"18mm\",\"material\":\"实木颗粒板/多层板\",\"thickness\":\"18mm\"},\"confidence\":\"high\",\"_tile\":1},{\"id\":5,\"type\":\"其他配饰\",\"description\":\"挂衣杆，位于中间主衣柜区中部\",\"position\":\"中左\",\"properties\":{\"width\":\"800mm\",\"height\":\"25mm\",\"material\":\"金属\",\"thickness\":\"25mm\"},\"confidence\":\"high\",\"_tile\":1},{\"id\":6,\"type\":\"板\",\"description\":\"水平隔板，位于右侧宽储物区上部，分隔小格子与大空间\",\"position\":\"右上\",\"properties\":{\"width\":\"600mm\",\"height\":\"18mm\",\"material\":\"实木颗粒板/多层板\",\"thickness\":\"18mm\"},\"confidence\":\"high\",\"_tile\":1}],\"spaces\":[{\"name\":\"顶部储物区\",\"estimated_area\":\"柜体总宽 x 500mm\",\"connections\":[\"手工材料包区\",\"被褥区\",\"文件/电子产品区\"],\"position\":\"柜体最上层\"},{\"name\":\"中部主要储物区\",\"estimated_area\":\"柜体总宽 x 915mm\",\"connections\":[\"次净衣区\",\"挂衣区\",\"模型/数码区\"],\"position\":\"柜体中上部\"},{\"name\":\"下部储物区\",\"estimated_area\":\"柜体总宽 x 415mm\",\"connections\":[\"袋子/球拍包区\",\"叠放衣物区\",\"常用物品区\"],\"position\":\"柜体中下部\"},{\"name\":\"底部储物区\",\"estimated_area\":\"柜体总宽 x 300mm\",\"connections\":[\"工具箱\",\"小金猪\",\"手工材料箱\"],\"position\":\"柜体最下层\"},{\"name\":\"左侧电子/杂物区\",\"estimated_area\":\"0.5平方米\",\"connections\":[\"中间主衣柜区\"],\"position\":\"最左侧（部分可见）\"},{\"name\":\"中间主衣柜区\",\"estimated_area\":\"2.5平方米\",\"connections\":[\"左侧电子/杂物区\",\"右侧宠物/杂物窄条区\"],\"position\":\"中间\"},{\"name\":\"右侧宠物/杂物窄条区\",\"estimated_area\":\"0.8平方米\",\"connections\":[\"中间主衣柜区\",\"右侧宽储物区\"],\"position\":\"中间偏右\"},{\"name\":\"右侧宠物用品区\",\"estimated_area\":\"1.2平方米\",\"connections\":[\"右侧宠物/杂物窄条区\"],\"position\":\"右侧\"}],\"dimensions\":[{\"value\":\"36\",\"target\":\"顶部间隙或顶板厚度\",\"position\":\"左侧最上方\"},{\"value\":\"500\",\"target\":\"第一层储物格高度\",\"position\":\"左侧上部\"},{\"value\":\"18\",\"target\":\"层板厚度\",\"position\":\"左侧尺寸标注链中\"},{\"value\":\"915\",\"target\":\"第二层储物格（挂衣/次净衣）高度\",\"position\":\"左侧中部\"},{\"value\":\"415\",\"target\":\"第三层储物格（叠放/袋子）高度\",\"position\":\"左侧下部\"},{\"value\":\"300\",\"target\":\"底部储物格高度\",\"position\":\"左侧最下方\"}],\"annotations\":[{\"text\":\"客厅衣柜/设备柜/宠物柜\",\"type\":\"title\",\"position\":\"顶部居中\"},{\"text\":\"手工材料包\",\"type\":\"label\",\"position\":\"左上格\"},{\"text\":\"手工工具\",\"type\":\"label\",\"position\":\"左上格虚线框内\"},{\"text\":\"次净衣区\",\"type\":\"label\",\"position\":\"左中格上部\"},{\"text\":\"包包\",\"type\":\"label\",\"position\":\"左中格下部\"},{\"text\":\"袋子\",\"type\":\"label\",\"position\":\"左下格虚线框内\"},{\"text\":\"球拍包\",\"type\":\"label\",\"position\":\"左下格虚线框内\"},{\"text\":\"工具箱\",\"type\":\"label\",\"position\":\"左底格\"},{\"text\":\"被子\",\"type\":\"label\",\"position\":\"中上格左侧\"},{\"text\":\"枕头\",\"type\":\"label\",\"position\":\"中上格左侧\"},{\"text\":\"沙发替换罩子\",\"type\":\"label\",\"position\":\"中上格右侧\"},{\"text\":\"吊带内衣内裤\",\"type\":\"label\",\"position\":\"中中格挂衣区最左\"},{\"text\":\"短袖T恤\",\"type\":\"label\",\"position\":\"中中格挂衣区\"},{\"text\":\"短袖衬衫\",\"type\":\"label\",\"position\":\"中中格挂衣区\"},{\"text\":\"长袖T恤\",\"type\":\"label\",\"position\":\"中中格挂衣区\"},{\"text\":\"长袖衬衫\",\"type\":\"label\",\"position\":\"中中格挂衣区\"},{\"text\":\"春秋外套\",\"type\":\"label\",\"position\":\"中中格挂衣区\"},{\"text\":\"卫衣\",\"type\":\"label\",\"position\":\"中中格挂衣区最右\"},{\"text\":\"短裤短裙\",\"type\":\"label\",\"position\":\"中下格叠放区最左\"},{\"text\":\"薄家居服\",\"type\":\"label\",\"position\":\"中下格叠放区\"},{\"text\":\"运动服\",\"type\":\"label\",\"position\":\"中下格叠放区\"},{\"text\":\"长裤\",\"type\":\"label\",\"position\":\"中下格叠放区最右\"},{\"text\":\"小金猪\",\"type\":\"label\",\"position\":\"中底格\"},{\"text\":\"重要文件\",\"type\":\"label\",\"position\":\"右上格左侧\"},{\"text\":\"按摩仪\",\"type\":\"label\",\"position\":\"右上格左侧\"},{\"text\":\"证书/纪念品\",\"type\":\"label\",\"position\":\"右上格右侧虚线框\"},{\"text\":\"电子产品\",\"type\":\"label\",\"position\":\"右上格右侧虚线框\"},{\"text\":\"手工模型\",\"type\":\"label\",\"position\":\"右中上格\"},{\"text\":\"乐高\",\"type\":\"label\",\"position\":\"右中上格\"},{\"text\":\"VR眼镜\",\"type\":\"label\",\"position\":\"右中上格\"},{\"text\":\"相机\",\"type\":\"label\",\"position\":\"右中上格\"},{\"text\":\"笔记本电脑\",\"type\":\"label\",\"position\":\"右中上格\"},{\"text\":\"常用物品\",\"type\":\"label\",\"position\":\"右中格虚线框内\"},{\"text\":\"手工材料箱\",\"type\":\"label\",\"position\":\"右底格虚线框\"},{\"text\":\"(有颜料)\",\"type\":\"note\",\"position\":\"右底格虚线框内\"},{\"text\":\"书/纪念品\",\"type\":\"label\",\"position\":\"左上\"},{\"text\":\"电子产品\",\"type\":\"label\",\"position\":\"左上\"},{\"text\":\"相机\",\"type\":\"label\",\"position\":\"左侧\"},{\"text\":\"笔记本电脑\",\"type\":\"label\",\"position\":\"左侧\"},{\"text\":\"常用物品\",\"type\":\"label\",\"position\":\"左侧\"},{\"text\":\"厚家居服\",\"type\":\"label\",\"position\":\"中上\"},{\"text\":\"毛衣\",\"type\":\"label\",\"position\":\"中上\"},{\"text\":\"连衣裙\",\"type\":\"label\",\"position\":\"中左\"},{\"text\":\"冬季厚外套\",\"type\":\"label\",\"position\":\"中\"},{\"text\":\"厚家居服\",\"type\":\"label\",\"position\":\"中下\"},{\"text\":\"袜子\",\"type\":\"label\",\"position\":\"中下\"},{\"text\":\"浴巾\",\"type\":\"label\",\"position\":\"中下\"},{\"text\":\"钱包\",\"type\":\"label\",\"position\":\"中下\"},{\"text\":\"围巾/帽子/配饰\",\"type\":\"label\",\"position\":\"中下\"},{\"text\":\"五金小工具\",\"type\":\"label\",\"position\":\"中右列上\"},{\"text\":\"狗狗衣服牵引绳\",\"type\":\"label\",\"position\":\"中右列中上\"},{\"text\":\"宠物零食\",\"type\":\"label\",\"position\":\"中右列中\"},{\"text\":\"宠物毯子小屋\",\"type\":\"label\",\"position\":\"中右列中下\"},{\"text\":\"猫砂猫包\",\"type\":\"label\",\"position\":\"中右列下\"},{\"text\":\"宠物尿片\",\"type\":\"label\",\"position\":\"右列上左\"},{\"text\":\"清洁用品\",\"type\":\"label\",\"position\":\"右列上中\"},{\"text\":\"宠物碗\",\"type\":\"label\",\"position\":\"右列上右\"},{\"text\":\"侧板按图开缺\",\"type\":\"note\",\"position\":\"右下\"}],\"ocr_verified\":[\"客厅\",\"衣柜\",\"/设备\",\"柜\",\"/\",\"宠\",\"物\",\"材\",\"重要\",\"文件\",\"证\",\"书\",\"/纪念\",\"品\",\"被\",\"子\",\"沙发\",\"证书/\",\"纪念品\",\"外\",\"包\",\"枕头\",\"换\",\"按摩\",\"仪\",\"电子\",\"工\",\"手工\",\"模型\",\"工具\",\"乐\",\"VR\",\"相机\",\"内\",\"衣\",\"袖\",\"机\",\"次\",\"净\",\"短\",\"长\",\"家\",\"动\",\"球拍\",\"居\",\"服\",\"材料\",\"箱\",\"零食\",\"毯子\",\"一\",\"|\"],\"ocr_unverified\":[\"#|\",\"，\",\"件\",\"四\",\".相机\",\"恤衫\",\"=\",\"&\",\"一\",\"E\",\"ol\",\"B\",\":\",\"证\",\"证书/\",\"到\",\";\",\"-+\",\"!\",\"<\",\"手\",\"有\",\"INR\",\"[一\",\"-一\"],\"summary\":\"这是一张客厅多功能组合柜的立面设计图，详细规划了左侧手工与次净衣收纳、中间衣物悬挂与叠放、右侧文件设备与杂物储存的分区及尺寸。 | 这是一张衣柜内部立面设计图，详细规划了衣物（外套、毛衣等）、电子产品、杂物以及大量宠物用品（猫砂、狗粮、宠物毯等）的收纳空间，并在右下角标注了侧板开缺的施工要求。\"}",
    "tileCount": 2,
    "mode": "tiled"
}
/**
 * 完整的图片识别流程
 */
export async function recognizeImage(imagePath: string, options: RecognitionOptions = {}, consoleLog: (msg: string) => void) {
  const startTime = Date.now()
  const baseName = path.basename(imagePath, path.extname(imagePath))

  // 准备输出目录
  const outputDir = options.outputDir || path.join(path.dirname(imagePath), 'results')
  ensureDir(outputDir)

  try {
    // Step 1: 图片预处理
    await consoleLog(`[1/4] 图纸预处理...`) 
    const preprocessResult = await preprocessImage(imagePath, path.join(outputDir, baseName),consoleLog)

    // Step 2: OCR 文字提取
    await consoleLog('[2/4] OCR 文字提取...')
    const ocrResult = await ocrStep(preprocessResult.binaryPath,consoleLog)

    // Step 3: Qwen-VL 视觉识别
    await consoleLog('[3/4] 大模型 视觉识别...')
    //const visionResult = await visionStep(preprocessResult.preprocessedPath, ocrResult,consoleLog)
    //console.log('@@@@@visionResult',JSON.stringify(visionResult))
    //Step 4: 后处理与结构化testData
    await consoleLog('[4/4] 后处理与结构化...')
    const finalResult = await postprocessStep(ocrResult, testData, preprocessResult.metadata,consoleLog)
    
    // 保存结果
    //const resultPath = path.join(outputDir, `${baseName}.result.json`)
    //saveFile(resultPath, finalResult)

    const elapsed = (Date.now() - startTime) / 1000

    await consoleLog(`识别完成，耗时 ${elapsed.toFixed(1)}s`)

    return {
      success: true,
      elapsed: `${elapsed.toFixed(1)}s`,
      result: finalResult,
      //resultFile: resultPath,
    }
  } catch (error) {
    console.error('识别失败:', (error as Error).message)
    return {
      success: false,
      error: (error as Error).message,
    }
  }
}

export * from './config'
export * from './image'
export * from './ocr'
export * from './vision'
export * from './postprocess'
