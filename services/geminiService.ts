import { GoogleGenAI, Type, Modality } from "@google/genai";
import type { OutfitRecommendation, Trend, ItemAnalysis } from '../types';

if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable is not set.");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const outfitSchema = {
    type: Type.OBJECT,
    properties: {
        outfitName: { type: Type.STRING, description: "Tên gợi ý cho bộ trang phục." },
        description: { type: Type.STRING, description: "Mô tả ngắn gọn về phong cách và dịp phù hợp cho bộ trang phục." },
        items: {
            type: Type.ARRAY,
            description: "Danh sách các món đồ trong bộ trang phục.",
            items: {
                type: Type.OBJECT,
                properties: {
                    type: { type: Type.STRING, description: "Loại món đồ (ví dụ: Áo, Quần, Váy, Giày, Phụ kiện)." },
                    description: { type: Type.STRING, description: "Mô tả chi tiết về món đồ, bao gồm màu sắc, chất liệu và kiểu dáng." }
                },
                required: ["type", "description"]
            }
        }
    },
    required: ["outfitName", "description", "items"]
};

// Updated schema to expect a direct array of trends
const trendsSchema = {
    type: Type.ARRAY,
    description: "Danh sách các xu hướng thời trang.",
    items: {
        type: Type.OBJECT,
        properties: {
            name: { type: Type.STRING, description: "Tên của xu hướng." },
            description: { type: Type.STRING, description: "Mô tả về xu hướng." },
            keyItems: {
                type: Type.ARRAY,
                description: "Các món đồ chính của xu hướng.",
                items: { type: Type.STRING }
            }
        },
        required: ["name", "description", "keyItems"]
    }
};

const generateImage = async (prompt: string): Promise<string> => {
    try {
        const response = await ai.models.generateImages({
            model: 'imagen-4.0-generate-001', // Changed to imagen-4.0-generate-001
            prompt: prompt,
            config: {
                numberOfImages: 1,
                outputMimeType: 'image/jpeg',
                aspectRatio: '1:1', // Default aspect ratio, can be customized
            },
        });

        const base64ImageBytes: string | undefined = response.generatedImages[0]?.image?.imageBytes;

        if (base64ImageBytes) {
            return `data:image/jpeg;base64,${base64ImageBytes}`;
        }
        
        // The `generateImages` API for `imagen-4.0-generate-001` does not expose `finishReason`
        // on the `image` object. If an image is not generated (e.g., due to safety reasons),
        // `base64ImageBytes` will be undefined, and the error will be caught below.
        console.error("Lỗi: Không nhận được dữ liệu hình ảnh từ generateImages. Phản hồi đầy đủ:", JSON.stringify(response, null, 2));
        throw new Error("Không nhận được dữ liệu hình ảnh từ API. Vui lòng kiểm tra lại prompt hoặc hạn mức API.");
    } catch (error) {
        console.error("Lỗi khi tạo hình ảnh (ngoại lệ API):", error);
        if (error instanceof Error && (error as any).details) { 
            console.error("Chi tiết lỗi:", (error as any).details);
        }
        if (error instanceof Error && error.message.includes("Quota exceeded")) {
            throw new Error("Không thể tạo hình ảnh do vượt quá hạn mức API. Vui lòng kiểm tra tài khoản Google Cloud của bạn.");
        }
        throw new Error(`Không thể tạo hình ảnh. Chi tiết: ${error instanceof Error ? error.message : String(error)}`);
    }
};


export const generateOutfit = async (
  bodyShape: string,
  style: string,
  occasion: string,
  weather: string
): Promise<OutfitRecommendation> => {
  const prompt = `Hãy đóng vai một nhà tạo mẫu thời trang chuyên nghiệp. Dựa trên các thông tin sau: Dáng người - ${bodyShape}, Phong cách - ${style}, Dịp - ${occasion}, Thời tiết - ${weather}. Hãy gợi ý một bộ trang phục hoàn chỉnh.`;

  try {
    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: outfitSchema,
        },
    });
    const jsonText = response.text.trim();
    let outfitData: Omit<OutfitRecommendation, 'imageUrl'>;
    try { 
      outfitData = JSON.parse(jsonText) as Omit<OutfitRecommendation, 'imageUrl'>;
    } catch (parseError) {
      // Ghi log chi tiết khi phân tích JSON thất bại
      console.error("Lỗi khi phân tích JSON cho trang phục:", parseError, { jsonText, originalResponse: response });
      throw new Error("Phản hồi không phải là JSON hợp lệ cho trang phục.");
    }

    const imagePrompt = `Một bức ảnh thời trang full-body, chất lượng cao của một người mẫu đang mặc bộ trang phục sau: ${outfitData.items.map(i => i.description).join(', ')}. Bối cảnh studio tối giản, ánh sáng đẹp.`;
    const imageUrl = await generateImage(imagePrompt);

    return { ...outfitData, imageUrl };
  } catch (error) {
    console.error("Lỗi khi tạo trang phục:", error);
    throw new Error("Không thể tạo gợi ý trang phục. Vui lòng thử lại.");
  }
};

export const fetchTrends = async (category: string): Promise<Trend[]> => {
    try {
        // Step 1: Get raw text and source URLs from Google Search
        const initialPrompt = `Tìm kiếm và tổng hợp ba xu hướng thời trang nổi bật nhất hiện nay hoặc theo chủ đề "${category}". Cung cấp một cái tên, mô tả ngắn gọn, và danh sách các món đồ chính cho mỗi xu hướng.`;
        
        const firstResponse = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: initialPrompt,
            config: {
                tools: [{ googleSearch: {} }],
                thinkingConfig: { thinkingBudget: 0 }, // Added thinkingConfig
            },
        });

        const rawTrendInfo = firstResponse.text;
        const sourceUrls = firstResponse.candidates?.[0]?.groundingMetadata?.groundingChunks?.map(chunk => ({
            uri: (chunk as any).web?.uri || (chunk as any).maps?.uri,
            title: (chunk as any).web?.title || (chunk as any).maps?.title,
        })).filter(item => item.uri) || [];

        // Step 2: Structure raw info into JSON using a second Gemini call with schema
        const structurePrompt = `Dựa trên thông tin sau đây về các xu hướng thời trang, hãy trích xuất và định dạng thành một mảng JSON gồm ba đối tượng xu hướng. Mỗi đối tượng cần có 'name' (string), 'description' (string), và 'keyItems' (một mảng các chuỗi). Dữ liệu thô:\n\n${rawTrendInfo}\n\nĐảm bảo cấu trúc JSON hợp lệ và chỉ trả về mảng JSON.`;

        const jsonResponse = await ai.models.generateContent({
            model: "gemini-2.5-flash", // No googleSearch here, as per guidelines for responseSchema
            contents: structurePrompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: trendsSchema,
                thinkingConfig: { thinkingBudget: 0 }, // Added thinkingConfig
            },
        });
        
        const jsonText = jsonResponse.text.trim();
        let trendsData: Omit<Trend, 'imageUrl' | 'sourceUrls'>[];
        try { 
          trendsData = JSON.parse(jsonText) as Omit<Trend, 'imageUrl' | 'sourceUrls'>[];
        } catch (parseError) {
          // Ghi log chi tiết khi phân tích JSON thất bại
          console.error("Lỗi khi phân tích JSON cho xu hướng:", parseError, { jsonText, originalResponse: jsonResponse });
          throw new Error("Phản hồi không phải là JSON hợp lệ cho xu hướng.");
        }

        // Step 3: Generate images for each trend and attach sourceUrls
        const trendsWithImages = await Promise.all(
            trendsData.map(async (trend) => {
                const imagePrompt = `Một bức ảnh thời trang nghệ thuật chất lượng cao thể hiện xu hướng "${trend.name}". Bao gồm các món đồ chính như ${trend.keyItems.join(', ')}. Phong cách hiện đại, sống động, bối cảnh phù hợp với xu hướng.`;
                const imageUrl = await generateImage(imagePrompt);
                return { ...trend, imageUrl, sourceUrls }; // Attach sourceUrls from the first call
            })
        );
        return trendsWithImages;
    } catch (error) {
        console.error("Lỗi khi lấy xu hướng:", error);
        throw new Error("Không thể lấy dữ liệu xu hướng. Vui lòng thử lại.");
    }
};

export const analyzeItemByText = async (text: string): Promise<ItemAnalysis> => {
    try {
        const textPrompt = `Cung cấp thông tin về món đồ thời trang sau: "${text}". Mô tả phong cách, các thương hiệu có thể có, và gợi ý cách phối đồ.`;
        const textResponse = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: textPrompt,
            config: {
              tools: [{googleSearch: {}}], // Sử dụng googleSearch
            },
        });
        const description = textResponse.text;
        
        // Trích xuất sourceUrls từ groundingChunks
        const sourceUrls = textResponse.candidates?.[0]?.groundingMetadata?.groundingChunks?.map(chunk => ({
            uri: (chunk as any).web?.uri || (chunk as any).maps?.uri,
            title: (chunk as any).web?.title || (chunk as any).maps?.title,
        })).filter(item => item.uri) || [];


        const imagePrompt = `Một bức ảnh thời trang, chất lượng cao của món đồ sau: "${text}", được phối trong một bộ trang phục hoàn chỉnh trên người mẫu.`;
        const imageUrl = await generateImage(imagePrompt);

        return { description, imageUrl, sourceUrls };
    } catch (error) {
        console.error("Lỗi khi phân tích bằng văn bản:", error);
        throw new Error("Không thể phân tích món đồ. Vui lòng thử lại.");
    }
};

export const analyzeItemByImage = async (base64Image: string, mimeType: string): Promise<ItemAnalysis> => {
    const imagePart = {
        inlineData: {
            data: base64Image,
            mimeType: mimeType,
        },
    };

    try {
        const textAnalysisPrompt = {
            parts: [imagePart, { text: "Mô tả món đồ thời trang này. Phong cách của nó là gì, có thể là của những thương hiệu nào, và gợi ý các món đồ để phối cùng?" }],
        };
        const textResponse = await ai.models.generateContent({
            model: "gemini-2.5-pro",
            contents: textAnalysisPrompt,
            config: {
              tools: [{googleSearch: {}}], // Sử dụng googleSearch
            },
        });
        const description = textResponse.text;

        // Trích xuất sourceUrls từ groundingChunks
        const sourceUrls = textResponse.candidates?.[0]?.groundingMetadata?.groundingChunks?.map(chunk => ({
            uri: (chunk as any).web?.uri || (chunk as any).maps?.uri,
            title: (chunk as any).web?.title || (chunk as any).maps?.title,
        })).filter(item => item.uri) || [];


        // Use generateContent with 'gemini-2.5-flash-image' for image editing based on the guidelines.
        const imageResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: {
                parts: [
                    imagePart,
                    {
                        text: "Tạo một hình ảnh mới, trong đó một người mẫu đang mặc món đồ này như một phần của một bộ trang phục thời trang hoàn chỉnh. Giữ lại phong cách của món đồ gốc nhưng đặt nó trong một bối cảnh mới.",
                    },
                ],
            },
            config: {
                responseModalities: [Modality.IMAGE], // Must be an array with a single `Modality.IMAGE` element.
            },
        });
        
        const generatedImageBase64 = imageResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!generatedImageBase64) {
            console.error("Lỗi: Dữ liệu hình ảnh bị thiếu trong phản hồi generateContent khi phân tích bằng hình ảnh. Phản hồi đầy đủ:", JSON.stringify(imageResponse, null, 2));
            throw new Error("Không thể tạo hình ảnh phối đồ.");
        }
        const imageUrl = `data:image/jpeg;base64,${generatedImageBase64}`;
        
        return { description, imageUrl, sourceUrls };
    } catch (error) {
        console.error("Lỗi khi phân tích bằng hình ảnh:", error);
        if (error instanceof Error && (error as any).details) { 
            console.error("Chi tiết lỗi:", (error as any).details);
        }
        throw new Error("Không thể phân tích món đồ từ hình ảnh. Vui lòng thử lại.");
    }
};