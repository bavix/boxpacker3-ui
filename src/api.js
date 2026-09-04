import axios from "axios";

export default async function (url, data) {
    try {
        const response = await axios.post(url, data)
        return response.data
    } catch (error) {
        const detail = error.response?.data
        return { error: typeof detail === 'string' && detail !== '' ? detail.trim() : error.message }
    }
}
